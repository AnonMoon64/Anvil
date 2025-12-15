/**
 * Anvil Wallet - Crypto Utilities
 * Browser-compatible Ed25519 signing using Web Crypto API
 */

// Base64 encoding/decoding
export function base64Encode(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64Decode(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// SHA-256 hash
export async function sha256(data) {
    const encoder = new TextEncoder();
    const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Hash an object (for transactions, blocks, etc.)
export async function hashObject(obj) {
    const json = JSON.stringify(obj, Object.keys(obj).sort());
    return sha256(json);
}

// Generate a new Ed25519 keypair (ECDSA P-256 for browser compatibility)
// Note: True Ed25519 requires a library like tweetnacl
export async function generateKeypair() {
    const keyPair = await crypto.subtle.generateKey(
        {
            name: 'ECDSA',
            namedCurve: 'P-256',
        },
        true,
        ['sign', 'verify']
    );

    // Export keys
    const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    // Create address from public key hash
    const publicKeyHash = await sha256(publicKeyRaw);
    const address = publicKeyHash.slice(0, 40);

    return {
        publicKey: base64Encode(publicKeyRaw),
        privateKeyJwk,
        address,
        keyPair,
    };
}

// Import a keypair from stored JWK
export async function importKeypair(privateKeyJwk) {
    const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateKeyJwk,
        {
            name: 'ECDSA',
            namedCurve: 'P-256',
        },
        true,
        ['sign']
    );

    // Derive public key from private key JWK
    const publicKeyJwk = {
        kty: privateKeyJwk.kty,
        crv: privateKeyJwk.crv,
        x: privateKeyJwk.x,
        y: privateKeyJwk.y,
    };

    const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        {
            name: 'ECDSA',
            namedCurve: 'P-256',
        },
        true,
        ['verify']
    );

    const publicKeyRaw = await crypto.subtle.exportKey('raw', publicKey);
    const publicKeyHash = await sha256(publicKeyRaw);
    const address = publicKeyHash.slice(0, 40);

    return {
        publicKey: base64Encode(publicKeyRaw),
        privateKeyJwk,
        address,
        keyPair: { publicKey, privateKey },
    };
}

// Sign data
export async function sign(keyPair, data) {
    const encoder = new TextEncoder();
    const dataBuffer = typeof data === 'string' ? encoder.encode(data) : encoder.encode(JSON.stringify(data));

    const signature = await crypto.subtle.sign(
        {
            name: 'ECDSA',
            hash: 'SHA-256',
        },
        keyPair.privateKey,
        dataBuffer
    );

    return base64Encode(signature);
}

// Verify signature
export async function verify(publicKeyBase64, signature, data) {
    try {
        const publicKeyRaw = base64Decode(publicKeyBase64);
        const publicKey = await crypto.subtle.importKey(
            'raw',
            publicKeyRaw,
            {
                name: 'ECDSA',
                namedCurve: 'P-256',
            },
            false,
            ['verify']
        );

        const encoder = new TextEncoder();
        const dataBuffer = typeof data === 'string' ? encoder.encode(data) : encoder.encode(JSON.stringify(data));
        const signatureBuffer = base64Decode(signature);

        return await crypto.subtle.verify(
            {
                name: 'ECDSA',
                hash: 'SHA-256',
            },
            publicKey,
            signatureBuffer,
            dataBuffer
        );
    } catch {
        return false;
    }
}

// Store keypair in localStorage
export function saveKeypair(keypairData) {
    const toStore = {
        privateKeyJwk: keypairData.privateKeyJwk,
        publicKey: keypairData.publicKey,
        address: keypairData.address,
    };
    localStorage.setItem('anvil_keypair', JSON.stringify(toStore));
}

// Load keypair from localStorage
export async function loadKeypair() {
    const stored = localStorage.getItem('anvil_keypair');
    if (!stored) return null;

    try {
        const data = JSON.parse(stored);
        return await importKeypair(data.privateKeyJwk);
    } catch {
        return null;
    }
}

// Check if keypair exists
export function hasKeypair() {
    return localStorage.getItem('anvil_keypair') !== null;
}

// Clear keypair
export function clearKeypair() {
    localStorage.removeItem('anvil_keypair');
}

// Export private key as JSON string (for backup)
export function exportPrivateKey() {
    const stored = localStorage.getItem('anvil_keypair');
    if (!stored) return null;

    const data = JSON.parse(stored);
    // Return a nicely formatted backup
    return JSON.stringify({
        version: 1,
        type: 'anvil-wallet-backup',
        address: data.address,
        publicKey: data.publicKey,
        privateKey: data.privateKeyJwk,
        created: new Date().toISOString(),
        warning: 'KEEP THIS SAFE! Anyone with this file can spend your funds.',
    }, null, 2);
}

// Import private key from backup JSON
export async function importPrivateKey(backupJson) {
    try {
        const backup = typeof backupJson === 'string' ? JSON.parse(backupJson) : backupJson;

        if (backup.version !== 1 || backup.type !== 'anvil-wallet-backup') {
            throw new Error('Invalid backup format');
        }

        // Import and verify
        const keypair = await importKeypair(backup.privateKey);

        // Save to localStorage
        saveKeypair(keypair);

        return keypair;
    } catch (err) {
        throw new Error(`Failed to import: ${err.message}`);
    }
}
