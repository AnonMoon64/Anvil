import { useState, useEffect, useCallback, useRef } from 'react';
import { AnvilClient, loadPreferredNode, savePreferredNode, fetchSeedNodes } from './api';
import { generateKeypair, loadKeypair, saveKeypair, hasKeypair, clearKeypair, sign, hashObject, exportPrivateKey, importPrivateKey, sha256 } from './crypto';

// Icons as simple SVG components
const SendIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
);

const ReceiveIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3v18m-6-6l6 6 6-6" />
    </svg>
);

const CopyIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
);

const RefreshIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
);

export default function App() {
    // State
    const [nodeUrl, setNodeUrl] = useState(loadPreferredNode());
    const [client] = useState(() => new AnvilClient(loadPreferredNode()));
    const [connected, setConnected] = useState(false);
    const [nodeHealth, setNodeHealth] = useState(null);

    const [wallet, setWallet] = useState(null);
    const [balance, setBalance] = useState(0);
    const [nonce, setNonce] = useState(0);
    const [loading, setLoading] = useState(true);

    const [activeTab, setActiveTab] = useState('wallet');
    const [sendTo, setSendTo] = useState('');
    const [sendAmount, setSendAmount] = useState('');
    const [sending, setSending] = useState(false);
    const [alert, setAlert] = useState(null);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showReceiveModal, setShowReceiveModal] = useState(false);
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [importKeyText, setImportKeyText] = useState('');

    // Mining state
    const [mining, setMining] = useState(false);
    const [miningStats, setMiningStats] = useState({
        effectiveness: 0,
        totalMined: 0,
        challengesAnswered: 0,
        uptime: 0,
        startTime: null,
    });
    const miningIntervalRef = useRef(null);

    // Initialize wallet and fetch seed nodes
    useEffect(() => {
        async function init() {
            // Load wallet
            if (hasKeypair()) {
                const keypair = await loadKeypair();
                setWallet(keypair);
            }

            // Always fetch fresh seed node from vaultlock.org
            try {
                const seeds = await fetchSeedNodes();
                if (seeds.length > 0 && seeds[0].name === 'Anvil Seed') {
                    console.log('Using seed node:', seeds[0].url);
                    setNodeUrl(seeds[0].url);
                    client.setNode(seeds[0].url);
                    savePreferredNode(seeds[0].url);
                }
            } catch (err) {
                console.warn('Seed discovery failed, using default:', err);
            }

            setLoading(false);
        }
        init();
    }, [client]);

    // Connect to node
    const connectToNode = useCallback(async () => {
        const result = await client.checkConnection();
        setConnected(result.connected);
        if (result.connected) {
            setNodeHealth(result.health);
        }
        return result.connected;
    }, [client]);

    // Fetch balance
    const fetchBalance = useCallback(async () => {
        if (!wallet || !connected) return;
        try {
            const account = await client.getBalance(wallet.address);
            setBalance(account.balance);
            setNonce(account.nonce);
        } catch (err) {
            console.error('Failed to fetch balance:', err);
        }
    }, [wallet, connected, client]);

    // Mining loop - poll for challenges and respond
    const miningLoop = useCallback(async () => {
        if (!wallet || !connected) return;

        try {
            // Poll for a challenge
            const pollResult = await client.pollChallenge(wallet.address);

            if (pollResult.ok && pollResult.challenge) {
                // Compute response (hash of nonce)
                const response = await sha256(pollResult.challenge.nonce);

                // Submit response
                const respondResult = await client.respondChallenge(
                    wallet.address,
                    pollResult.challenge.id,
                    response
                );

                if (respondResult.ok) {
                    // Update stats
                    setMiningStats(s => ({
                        ...s,
                        effectiveness: respondResult.effectiveness,
                        totalMined: respondResult.balance || s.totalMined,
                        challengesAnswered: respondResult.successfulChallenges,
                    }));

                    // Update balance
                    setBalance(respondResult.balance);

                    console.log(`Challenge ${pollResult.challenge.id.slice(0, 8)}... answered! +${respondResult.reward} ANVIL`);
                }
            }
        } catch (err) {
            console.error('Mining loop error:', err.message);
        }
    }, [wallet, connected, client]);

    // Start/stop mining
    const startMining = useCallback(async () => {
        if (!wallet || !connected) return;

        try {
            // Register with the node
            await client.registerParticipant(wallet.address, wallet.publicKey);

            setMining(true);
            setMiningStats(s => ({ ...s, startTime: Date.now() }));

            // Run mining loop every 3 seconds
            miningIntervalRef.current = setInterval(miningLoop, 3000);

            // Run immediately
            miningLoop();

            showAlert('Mining started! Keep wallet open to earn.', 'success');
        } catch (err) {
            console.error('Failed to start mining:', err);
            showAlert('Failed to start mining: ' + err.message, 'error');
        }
    }, [wallet, connected, client, miningLoop]);

    const stopMining = useCallback(() => {
        setMining(false);
        if (miningIntervalRef.current) {
            clearInterval(miningIntervalRef.current);
            miningIntervalRef.current = null;
        }
        showAlert('Mining stopped', 'info');
    }, []);

    // Cleanup mining on unmount
    useEffect(() => {
        return () => {
            if (miningIntervalRef.current) {
                clearInterval(miningIntervalRef.current);
            }
        };
    }, []);

    // Poll connection and balance
    useEffect(() => {
        connectToNode();
        const interval = setInterval(() => {
            connectToNode();
            fetchBalance();
        }, 5000);
        return () => clearInterval(interval);
    }, [connectToNode, fetchBalance]);

    useEffect(() => {
        if (connected && wallet) {
            fetchBalance();
        }
    }, [connected, wallet, fetchBalance]);

    // Change node
    const handleNodeChange = (url) => {
        setNodeUrl(url);
        client.setNode(url);
        savePreferredNode(url);
        connectToNode();
    };

    // Create new wallet
    const createWallet = async () => {
        const keypair = await generateKeypair();
        saveKeypair(keypair);
        setWallet(keypair);
        setShowCreateModal(false);
        showAlert('Wallet created successfully!', 'success');
    };

    // Delete wallet
    const deleteWallet = () => {
        if (confirm('Are you sure? This will delete your keys permanently.')) {
            clearKeypair();
            setWallet(null);
            setBalance(0);
            setNonce(0);
        }
    };

    // Export private key
    const handleExportKey = () => {
        const backup = exportPrivateKey();
        if (backup) {
            // Create download
            const blob = new Blob([backup], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `anvil-wallet-backup-${wallet.address.slice(0, 8)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showAlert('Backup downloaded!', 'success');
        }
    };

    // Import private key
    const handleImportKey = async () => {
        try {
            const keypair = await importPrivateKey(importKeyText);
            setWallet(keypair);
            setShowBackupModal(false);
            setImportKeyText('');
            showAlert('Wallet restored successfully!', 'success');
        } catch (err) {
            showAlert(err.message, 'error');
        }
    };

    // Copy to clipboard
    const copyToClipboard = async (text) => {
        await navigator.clipboard.writeText(text);
        showAlert('Copied to clipboard!', 'success');
    };

    // Show alert
    const showAlert = (message, type = 'success') => {
        setAlert({ message, type });
        setTimeout(() => setAlert(null), 3000);
    };

    // Send transaction
    const handleSend = async () => {
        if (!sendTo || !sendAmount) {
            showAlert('Please enter recipient and amount', 'error');
            return;
        }

        const amount = parseFloat(sendAmount);
        if (isNaN(amount) || amount <= 0) {
            showAlert('Invalid amount', 'error');
            return;
        }

        if (amount > balance) {
            showAlert('Insufficient balance', 'error');
            return;
        }

        setSending(true);
        try {
            // Create transaction
            const tx = {
                from: wallet.address,
                to: sendTo,
                amount,
                nonce: nonce + 1,
                timestamp: Date.now(),
            };

            // Sign it
            const txHash = await hashObject(tx);
            tx.signature = await sign(wallet.keyPair, txHash);
            tx.publicKey = wallet.publicKey;

            // Submit
            await client.submitTransaction(tx);

            showAlert(`Sent ${amount} ANVIL to ${sendTo.slice(0, 8)}...`, 'success');
            setSendTo('');
            setSendAmount('');

            // Refresh balance after a delay
            setTimeout(fetchBalance, 2000);
        } catch (err) {
            showAlert(err.message || 'Transaction failed', 'error');
        } finally {
            setSending(false);
        }
    };

    // Request from faucet
    const requestFaucet = async () => {
        try {
            await client.faucet(1000);
            showAlert('Faucet request sent! Wait for next block.', 'success');
            setTimeout(fetchBalance, 5000);
        } catch (err) {
            showAlert(err.message || 'Faucet failed', 'error');
        }
    };

    if (loading) {
        return (
            <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="loading" style={{ width: 32, height: 32 }}></div>
            </div>
        );
    }

    return (
        <div className="app">
            {/* Header */}
            <header className="header">
                <div className="header-brand">
                    <h1>⚒ Anvil Wallet</h1>
                </div>
                <div className="header-status">
                    <span className={`status-dot ${connected ? 'connected' : ''}`}></span>
                    <span>{connected ? 'Connected' : 'Disconnected'}</span>
                </div>
            </header>

            {/* Alert */}
            {alert && (
                <div className={`alert alert-${alert.type} animate-in`}>
                    {alert.message}
                </div>
            )}

            {/* Node Selector - Hidden, uses auto-discovery from vaultlock.org */}
            {/* <div className="node-selector">
                <input
                    type="text"
                    className="form-input node-input"
                    value={nodeUrl}
                    onChange={(e) => setNodeUrl(e.target.value)}
                    placeholder="Node URL"
                />
                <button className="btn btn-secondary" onClick={() => handleNodeChange(nodeUrl)}>
                    <RefreshIcon />
                </button>
            </div> */}

            {!wallet ? (
                /* No Wallet State */
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-state-icon">🔐</div>
                        <p className="empty-state-text">No wallet found. Create one or restore from backup.</p>
                        <div className="btn-group" style={{ justifyContent: 'center', marginTop: '24px' }}>
                            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                                Create Wallet
                            </button>
                            <button className="btn btn-secondary" onClick={() => setShowBackupModal(true)}>
                                Restore from Backup
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                /* Wallet View */
                <>
                    {/* Balance Card */}
                    <div className="card">
                        <div className="balance-display">
                            <div className="balance-amount">
                                {balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="balance-currency">ANVIL</div>
                        </div>
                        <div className="btn-group">
                            <button className="btn btn-primary" onClick={() => setActiveTab('send')}>
                                <SendIcon /> Send
                            </button>
                            <button className="btn btn-secondary" onClick={() => setShowReceiveModal(true)}>
                                <ReceiveIcon /> Receive
                            </button>
                        </div>
                    </div>

                    {/* Address Card */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Your Address</span>
                            <button className="btn btn-icon" onClick={() => copyToClipboard(wallet.address)}>
                                <CopyIcon />
                            </button>
                        </div>
                        <div className="address-display">
                            <span className="address-text">{wallet.address}</span>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="tabs">
                        <button
                            className={`tab ${activeTab === 'wallet' ? 'active' : ''}`}
                            onClick={() => setActiveTab('wallet')}
                        >
                            Wallet
                        </button>
                        <button
                            className={`tab ${activeTab === 'send' ? 'active' : ''}`}
                            onClick={() => setActiveTab('send')}
                        >
                            Send
                        </button>
                        <button
                            className={`tab ${activeTab === 'mining' ? 'active' : ''}`}
                            onClick={() => setActiveTab('mining')}
                        >
                            ⛏️ Mine
                        </button>
                        <button
                            className={`tab ${activeTab === 'network' ? 'active' : ''}`}
                            onClick={() => setActiveTab('network')}
                        >
                            Network
                        </button>
                    </div>

                    {/* Tab Content */}
                    {activeTab === 'wallet' && (
                        <div className="card animate-in">
                            <div className="card-header">
                                <span className="card-title">Account Info</span>
                            </div>
                            <div style={{ display: 'grid', gap: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Balance</span>
                                    <span style={{ fontFamily: 'var(--font-mono)' }}>{balance.toFixed(4)} ANVIL</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Nonce</span>
                                    <span style={{ fontFamily: 'var(--font-mono)' }}>{nonce}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Address</span>
                                    <span style={{ fontFamily: 'var(--font-mono)' }}>{wallet.address}</span>
                                </div>
                            </div>
                            <div className="btn-group">
                                <button className="btn btn-secondary" onClick={requestFaucet}>
                                    🚰 Request Faucet
                                </button>
                                <button className="btn btn-secondary" onClick={handleExportKey}>
                                    💾 Backup Keys
                                </button>
                            </div>
                            <div className="btn-group" style={{ marginTop: '8px' }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={deleteWallet}
                                    style={{ color: 'var(--error)' }}
                                >
                                    🗑️ Delete Wallet
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'send' && (
                        <div className="card animate-in">
                            <div className="card-header">
                                <span className="card-title">Send ANVIL</span>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Recipient Address</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="e.g. a1b2c3d4e5f6..."
                                    value={sendTo}
                                    onChange={(e) => setSendTo(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Amount</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    placeholder="0.00"
                                    value={sendAmount}
                                    onChange={(e) => setSendAmount(e.target.value)}
                                />
                            </div>
                            <button
                                className="btn btn-primary"
                                style={{ width: '100%' }}
                                onClick={handleSend}
                                disabled={sending}
                            >
                                {sending ? <span className="loading"></span> : <><SendIcon /> Send Transaction</>}
                            </button>
                        </div>
                    )}

                    {activeTab === 'mining' && (
                        <div className="card animate-in">
                            <div className="card-header">
                                <span className="card-title">⛏️ Mining Status</span>
                                <span className={`status-dot ${mining ? 'connected' : ''}`}></span>
                            </div>

                            {/* Mining Stats */}
                            <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Status</span>
                                    <span style={{ color: mining ? 'var(--success)' : 'var(--text-secondary)' }}>
                                        {mining ? '🟢 Mining' : '⚫ Stopped'}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Effectiveness</span>
                                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                                        {(miningStats.effectiveness * 100).toFixed(1)}%
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Total Mined</span>
                                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                                        {miningStats.totalMined.toFixed(2)} ANVIL
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Challenges Answered</span>
                                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                                        {miningStats.challengesAnswered}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Uptime</span>
                                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                                        {miningStats.startTime
                                            ? `${Math.floor((Date.now() - miningStats.startTime) / 60000)} min`
                                            : '0 min'}
                                    </span>
                                </div>
                            </div>

                            {/* Effectiveness Progress Bar */}
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '8px',
                                    fontSize: '12px',
                                    color: 'var(--text-secondary)'
                                }}>
                                    <span>Effectiveness Progress</span>
                                    <span>~{Math.round(miningStats.effectiveness * 120)} / 120 days</span>
                                </div>
                                <div style={{
                                    height: '8px',
                                    background: 'var(--bg-tertiary)',
                                    borderRadius: '4px',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{
                                        width: `${miningStats.effectiveness * 100}%`,
                                        height: '100%',
                                        background: 'linear-gradient(90deg, var(--accent), var(--success))',
                                        borderRadius: '4px',
                                        transition: 'width 0.5s ease'
                                    }}></div>
                                </div>
                            </div>

                            {/* Info Box */}
                            <div style={{
                                background: 'var(--bg-tertiary)',
                                padding: '12px',
                                borderRadius: '8px',
                                marginBottom: '20px',
                                fontSize: '13px',
                                color: 'var(--text-secondary)'
                            }}>
                                💡 Mining in Anvil means staying online and responding to challenges.
                                Effectiveness builds over ~120 days. Rewards are proportional to your effectiveness.
                            </div>

                            {/* Start/Stop Button */}
                            <button
                                className={`btn ${mining ? 'btn-secondary' : 'btn-primary'}`}
                                style={{ width: '100%' }}
                                onClick={() => {
                                    if (mining) {
                                        stopMining();
                                    } else {
                                        startMining();
                                    }
                                }}
                                disabled={!connected || !wallet}
                            >
                                {mining ? '⏹️ Stop Mining' : '▶️ Start Mining'}
                            </button>

                            {!connected && (
                                <p style={{
                                    color: 'var(--error)',
                                    fontSize: '13px',
                                    textAlign: 'center',
                                    marginTop: '12px'
                                }}>
                                    Connect to a node first
                                </p>
                            )}

                            {connected && !wallet && (
                                <p style={{
                                    color: 'var(--warning)',
                                    fontSize: '13px',
                                    textAlign: 'center',
                                    marginTop: '12px'
                                }}>
                                    Create a wallet first
                                </p>
                            )}
                        </div>
                    )}

                    {activeTab === 'network' && (
                        <div className="card animate-in">
                            <div className="card-header">
                                <span className="card-title">Node Status</span>
                                <button className="btn btn-icon" onClick={connectToNode}>
                                    <RefreshIcon />
                                </button>
                            </div>
                            {nodeHealth ? (
                                <div style={{ display: 'grid', gap: '12px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Node</span>
                                        <span>{nodeHealth.name}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Epoch</span>
                                        <span style={{ fontFamily: 'var(--font-mono)' }}>{nodeHealth.epoch}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Chain Length</span>
                                        <span style={{ fontFamily: 'var(--font-mono)' }}>{nodeHealth.chainLength} blocks</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Peers</span>
                                        <span style={{ fontFamily: 'var(--font-mono)' }}>{nodeHealth.peers}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>View Changes</span>
                                        <span style={{ fontFamily: 'var(--font-mono)' }}>{nodeHealth.stats?.viewChanges || 0}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <p className="empty-state-text">Not connected to node</p>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* Create Wallet Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal animate-in" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Create New Wallet</h2>
                            <button className="btn btn-icon" onClick={() => setShowCreateModal(false)}>✕</button>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
                            This will generate a new keypair stored locally in your browser.
                            <br /><br />
                            <strong style={{ color: 'var(--warning)' }}>⚠️ Back up your keys!</strong>
                            If you clear browser data, your wallet will be lost.
                        </p>
                        <button className="btn btn-primary" style={{ width: '100%' }} onClick={createWallet}>
                            Generate Wallet
                        </button>
                    </div>
                </div>
            )}

            {/* Receive Modal */}
            {showReceiveModal && wallet && (
                <div className="modal-overlay" onClick={() => setShowReceiveModal(false)}>
                    <div className="modal animate-in" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Receive ANVIL</h2>
                            <button className="btn btn-icon" onClick={() => setShowReceiveModal(false)}>✕</button>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Share this address to receive funds:
                        </p>
                        <div className="address-display" style={{ marginBottom: '16px' }}>
                            <span className="address-text">{wallet.address}</span>
                        </div>
                        <button
                            className="btn btn-primary"
                            style={{ width: '100%' }}
                            onClick={() => { copyToClipboard(wallet.address); setShowReceiveModal(false); }}
                        >
                            <CopyIcon /> Copy Address
                        </button>
                    </div>
                </div>
            )}

            {/* Backup/Restore Modal */}
            {showBackupModal && (
                <div className="modal-overlay" onClick={() => setShowBackupModal(false)}>
                    <div className="modal animate-in" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Restore from Backup</h2>
                            <button className="btn btn-icon" onClick={() => setShowBackupModal(false)}>✕</button>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Paste your backup JSON to restore your wallet:
                        </p>
                        <div className="form-group">
                            <textarea
                                className="form-input"
                                style={{ minHeight: '150px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                                placeholder='{"version": 1, "type": "anvil-wallet-backup", ...}'
                                value={importKeyText}
                                onChange={(e) => setImportKeyText(e.target.value)}
                            />
                        </div>
                        <button
                            className="btn btn-primary"
                            style={{ width: '100%' }}
                            onClick={handleImportKey}
                            disabled={!importKeyText.trim()}
                        >
                            Restore Wallet
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
