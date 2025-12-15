/**
 * Anvil Node - Connectivity Detection
 * Automatic detection of network reachability:
 * 1. Try IPv6 inbound
 * 2. Try UPnP/NAT-PMP port mapping
 * 3. Fall back to outbound-only mode with relay
 */

const http = require('http');
const https = require('https');
const { networkInterfaces } = require('os');
const dgram = require('dgram');

const UPNP_SEARCH_TIMEOUT = 3000;
const NAT_PMP_TIMEOUT = 2000;

/**
 * Get all local IP addresses
 */
function getLocalAddresses() {
    const interfaces = networkInterfaces();
    const addresses = { ipv4: [], ipv6: [] };

    for (const [name, nets] of Object.entries(interfaces)) {
        for (const net of nets) {
            if (net.internal) continue;

            if (net.family === 'IPv4') {
                addresses.ipv4.push({ address: net.address, interface: name });
            } else if (net.family === 'IPv6' && !net.address.startsWith('fe80')) {
                // Exclude link-local IPv6
                addresses.ipv6.push({ address: net.address, interface: name });
            }
        }
    }

    return addresses;
}

/**
 * Check if we have a public IPv6 address
 */
function hasPublicIPv6() {
    const addresses = getLocalAddresses();
    // Global unicast IPv6 addresses start with 2 or 3
    return addresses.ipv6.some(a =>
        a.address.startsWith('2') || a.address.startsWith('3')
    );
}

/**
 * Try to discover UPnP gateway for port mapping
 */
function discoverUPnP() {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        let closed = false;
        let found = null;

        const closeSocket = () => {
            if (!closed) {
                closed = true;
                try { socket.close(); } catch { }
            }
        };

        const searchMessage = Buffer.from(
            'M-SEARCH * HTTP/1.1\r\n' +
            'HOST: 239.255.255.250:1900\r\n' +
            'MAN: "ssdp:discover"\r\n' +
            'MX: 2\r\n' +
            'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n' +
            '\r\n'
        );

        socket.on('message', (msg, rinfo) => {
            const response = msg.toString();
            const locationMatch = response.match(/LOCATION:\s*(.+)/i);
            if (locationMatch) {
                found = {
                    type: 'upnp',
                    location: locationMatch[1].trim(),
                    address: rinfo.address,
                };
            }
        });

        socket.on('error', () => {
            closeSocket();
            resolve(null);
        });

        socket.bind(() => {
            try {
                socket.addMembership('239.255.255.250');
                socket.send(searchMessage, 0, searchMessage.length, 1900, '239.255.255.250');
            } catch {
                closeSocket();
                resolve(null);
            }
        });

        setTimeout(() => {
            closeSocket();
            resolve(found);
        }, UPNP_SEARCH_TIMEOUT);
    });
}

/**
 * Try NAT-PMP (common on Apple routers)
 */
function tryNatPmp(gatewayIp) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        let closed = false;

        const closeSocket = () => {
            if (!closed) {
                closed = true;
                try { socket.close(); } catch { }
            }
        };

        // NAT-PMP external address request
        const request = Buffer.from([0, 0]); // Version 0, opcode 0

        socket.on('message', (msg) => {
            if (msg[0] === 0 && msg[1] === 128) {
                // Success response
                const ip = `${msg[8]}.${msg[9]}.${msg[10]}.${msg[11]}`;
                closeSocket();
                resolve({ type: 'nat-pmp', externalIp: ip, gateway: gatewayIp });
            }
        });

        socket.on('error', () => {
            closeSocket();
            resolve(null);
        });

        socket.send(request, 0, request.length, 5351, gatewayIp);

        setTimeout(() => {
            closeSocket();
            resolve(null);
        }, NAT_PMP_TIMEOUT);
    });
}

/**
 * Test if a port is reachable from outside using a public service
 */
async function testExternalReachability(port, publicTestUrl = null) {
    // If no test URL provided, we can't test externally
    if (!publicTestUrl) return false;

    return new Promise((resolve) => {
        const url = new URL(publicTestUrl);
        const client = url.protocol === 'https:' ? https : http;

        const req = client.get(publicTestUrl, { timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                resolve(data.includes('reachable'));
            });
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

/**
 * Detect best connectivity mode
 * Returns: { mode, endpoints, supportsRelay }
 */
async function detectConnectivity(port, options = {}) {
    const result = {
        mode: 'outbound-only',  // Default to outbound-only
        reachable: false,
        endpoints: [],
        supportsRelay: true,
        details: {},
    };

    const addresses = getLocalAddresses();
    result.details.localAddresses = addresses;

    // 1. Check for public IPv6
    if (hasPublicIPv6()) {
        const ipv6Addr = addresses.ipv6.find(a =>
            a.address.startsWith('2') || a.address.startsWith('3')
        );
        if (ipv6Addr) {
            result.endpoints.push({
                type: 'ipv6',
                address: `[${ipv6Addr.address}]:${port}`,
                url: `http://[${ipv6Addr.address}]:${port}`,
            });
            result.mode = 'ipv6-direct';
            result.reachable = true;
            console.log(`✓ Found public IPv6: ${ipv6Addr.address}`);
        }
    }

    // 2. Try UPnP discovery
    console.log('Checking UPnP...');
    const upnp = await discoverUPnP();
    if (upnp) {
        result.details.upnp = upnp;
        console.log(`✓ Found UPnP gateway at ${upnp.address}`);
        // In a full implementation, we'd request port mapping here
        // For now, just note that UPnP is available
        result.details.upnpAvailable = true;
    }

    // 3. Try NAT-PMP (use common gateway IPs)
    const gatewayIps = ['192.168.1.1', '192.168.0.1', '10.0.0.1'];
    for (const gw of gatewayIps) {
        const pmp = await tryNatPmp(gw);
        if (pmp) {
            result.details.natPmp = pmp;
            console.log(`✓ Found NAT-PMP, external IP: ${pmp.externalIp}`);

            // Add IPv4 endpoint
            result.endpoints.push({
                type: 'ipv4-natpmp',
                address: `${pmp.externalIp}:${port}`,
                url: `http://${pmp.externalIp}:${port}`,
            });
            if (result.mode === 'outbound-only') {
                result.mode = 'nat-pmp';
                result.reachable = true;
            }
            break;
        }
    }

    // If still outbound-only, add local addresses for LAN use
    if (!result.reachable) {
        for (const addr of addresses.ipv4) {
            result.endpoints.push({
                type: 'ipv4-local',
                address: `${addr.address}:${port}`,
                url: `http://${addr.address}:${port}`,
                localOnly: true,
            });
        }
        console.log('⚠ No public reachability, using outbound-only mode');
    }

    return result;
}

/**
 * Create announcement data for peer discovery
 */
function createAnnouncement(nodeId, port, connectivity, publicKeyInfo) {
    return {
        id: nodeId,
        version: 1,
        timestamp: Date.now(),

        // Connectivity info
        reachable: connectivity.reachable,
        mode: connectivity.mode,
        endpoints: connectivity.endpoints,
        supportsRelay: connectivity.supportsRelay,

        // Identity
        publicKeyPem: publicKeyInfo.publicKeyPem,
        publicKeyHash: publicKeyInfo.publicKeyHash,

        // Preferred URL (first reachable endpoint or first local)
        url: connectivity.endpoints.length > 0
            ? connectivity.endpoints.find(e => !e.localOnly)?.url
            || connectivity.endpoints[0]?.url
            : null,
    };
}

module.exports = {
    getLocalAddresses,
    hasPublicIPv6,
    discoverUPnP,
    tryNatPmp,
    testExternalReachability,
    detectConnectivity,
    createAnnouncement,
};
