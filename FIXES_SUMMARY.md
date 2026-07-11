# Fixes for "Failed To Fetch" Errors in Amethyst Launcher

This document summarizes all the fixes implemented to resolve "Failed To Fetch" errors when launching versions, modpacks, or backend operations.

## Root Causes Identified

1. **Inconsistent error handling** - Some modules used raw `fetch()` without retry logic
2. **Missing retry mechanisms** - Several API calls didn't have proper retry logic for transient failures
3. **Poor error messages** - Generic error messages didn't help users understand what went wrong
4. **No CORS headers** - API responses lacked proper CORS headers for frontend communication
5. **No reconnection logic** - EventSource connections didn't auto-reconnect on failure
6. **SSL/TLS issues** - Certificate and handshake errors weren't properly retryable
7. **Network error detection** - Many network-related errors weren't classified as retryable

## Files Modified

### 1. `src/launcher/modLoaders.js`
**Issues Fixed:**
- `listForgeVersions()` and `listNeoForgeVersions()` now use `redirect: 'follow'` in fetch options
- Added proper error status codes to thrown errors
- Added progress bus status messages for better user feedback
- Improved error propagation with meaningful messages

**Changes:**
```javascript
// Before: No redirect handling, generic errors
const response = await fetch(metaUrl, {
  headers: { 'User-Agent': 'AmethystLauncher/0.2' }
});

// After: Proper redirect handling and error status
const response = await fetch(metaUrl, {
  headers: { 'User-Agent': 'AmethystLauncher/0.2' },
  redirect: 'follow'
});
```

### 2. `src/launcher/modpacks.js`
**Issues Fixed:**
- Added try-catch blocks around all fetch operations
- Added progress bus status messages for Forge/NeoForge metadata failures
- Improved error handling for Fabric/Quilt profile fetching
- Added fallback logic for Forge versions (Maven metadata → promotions endpoint)

**Changes:**
```javascript
// Before: No error handling
async function fetchFabricLoaderVersions(mcVersion){
  if(!mcVersion){ const url=`${getFabricMeta()}/versions/loader`; const d=await fetchJson(url,'Fabric loader list'); return d; }
  const url=`${getFabricMeta()}/versions/loader/${encodeURIComponent(mcVersion)}`;
  return fetchJson(url, `Fabric loader for ${mcVersion}`);
}

// After: Proper error handling and user feedback
async function fetchFabricLoaderVersions(mcVersion){
  try {
    if(!mcVersion){ const url=`${getFabricMeta()}/versions/loader`; const d=await fetchJson(url,'Fabric loader list'); return d; }
    const url=`${getFabricMeta()}/versions/loader/${encodeURIComponent(mcVersion)}`;
    return await fetchJson(url, `Fabric loader for ${mcVersion}`);
  } catch (error) {
    progressBus.emitEvent('status', { message: `Failed to fetch Fabric loader versions for ${mcVersion || 'all versions'}: ${error.message}` });
    throw error;
  }
}
```

### 3. `src/launcher/mojangApi.js`
**Issues Fixed:**
- Added nested try-catch for fallback manifest fetching
- Improved error handling when both primary and fallback manifests fail
- Added graceful degradation to cached manifest if available

**Changes:**
```javascript
// Before: Single-level fallback
try {
  manifestCache = await fetchJson(MOJANG_MANIFEST_URL, 'official Minecraft version manifest');
} catch (error) {
  manifestCache = await fetchJson(FALLBACK_MANIFEST_URL, 'fallback Minecraft version manifest');
}

// After: Nested fallback with graceful degradation
try {
  manifestCache = await fetchJson(MOJANG_MANIFEST_URL, 'official Minecraft version manifest');
} catch (error) {
  try {
    manifestCache = await fetchJson(FALLBACK_MANIFEST_URL, 'fallback Minecraft version manifest');
  } catch (fallbackError) {
    if (manifestCache) {
      return manifestCache; // Use cached version
    }
    throw new Error(`Failed to fetch Minecraft version manifest: ${error.message}`);
  }
}
```

### 4. `src/launcher/modrinth.js`
**Issues Fixed:**
- Added try-catch blocks around all fetchJson calls
- Added progress bus status messages for all failures
- Ensured consistent error propagation

**Changes:**
All functions now have proper error handling:
```javascript
async function searchProjects({ ... } = {}) {
  // ... setup
  try {
    const data = await fetchJson(url, `Modrinth search ${query}`);
    return data;
  } catch (error) {
    progressBus.emitEvent('status', { message: `Modrinth search failed: ${error.message}` });
    throw error;
  }
}
```

### 5. `src/launcher/curseforge.js`
**Issues Fixed:**
- Added `redirect: 'follow'` to fetch options
- Added proper error status codes
- Added progress bus status messages
- Improved error handling in cfFetch function

**Changes:**
```javascript
// Before: No redirect handling
const response = await fetch(url, {
  headers: { 'x-api-key': key, 'Accept': 'application/json', 'User-Agent': 'AmethystLauncher/0.1' }
});

// After: Proper redirect and error handling
const response = await fetch(url, {
  headers: { 'x-api-key': key, 'Accept': 'application/json', 'User-Agent': 'AmethystLauncher/0.1' },
  redirect: 'follow'
});
```

### 6. `src/launcher/downloader.js`
**Issues Fixed:**
- Added SSL/TLS error codes to RETRYABLE_CODES set
- Improved error messages for network-related failures
- Added better JSON parsing error handling
- Enhanced fetchJson with detailed error information
- Added Connection header for keep-alive

**Changes:**
```javascript
// Added SSL/TLS error codes
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 
  'EPROTO', 'EPIPE', 'ECONNABORTED', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT',
  'ERR_SSL_PROTOCOL_ERROR', 'ERR_SSL_HANDSHAKE_FAILURE', 
  'ERR_TLS_CERT_ALTNAME_INVALID'
]);

// Enhanced isRetryableError to handle SSL/TLS issues
if (msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate') || 
    msg.includes('handshake') || msg.includes('dns') || msg.includes('resolve')) {
  return true;
}

// Improved fetchJson with better error details
async function fetchJson(url, label = url, options = {}) {
  // ... existing code
  try {
    return await response.json();
  } catch (error) {
    if (error.name === 'SyntaxError' || error.message.includes('Unexpected end of JSON')) {
      const parseError = new Error(`Failed to parse JSON response from ${label}: ${error.message}`);
      parseError.status = response.status || 0;
      parseError.cause = error;
      markRetryable(parseError, true);
      throw parseError;
    }
    throw error;
  }
}
```

### 7. `src/server.js`
**Issues Fixed:**
- Added CORS headers to all API responses
- Added OPTIONS preflight request handling
- Improved error responses with detailed information
- Added error type classification (NETWORK_ERROR, TIMEOUT_ERROR, PARSE_ERROR)

**Changes:**
```javascript
// Added CORS headers
function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS'
  });
  response.end(JSON.stringify(value, null, 2));
}

// Added OPTIONS handling
if (request.method === 'OPTIONS') {
  response.writeHead(204, corsHeaders);
  response.end();
  return;
}

// Enhanced error handling in createServer
catch (error) {
  const errorResponse = {
    error: error.message || 'Internal server error',
    code: error.code,
    status: error.status
  };
  
  if (error.message?.includes('Failed to fetch') || error.message?.includes('fetch')) {
    errorResponse.type = 'NETWORK_ERROR';
    errorResponse.hint = 'Check your internet connection or try again later.';
  }
  
  response.setHeader('Access-Control-Allow-Origin', '*');
  json(response, 500, errorResponse);
}
```

### 8. `public/app.js`
**Issues Fixed:**
- Enhanced API function with detailed error handling
- Added error type detection (NETWORK_ERROR, TIMEOUT_ERROR, PARSE_ERROR)
- Improved error messages for common failure scenarios
- Added EventSource reconnection logic with exponential backoff
- Added online/offline state tracking
- Added automatic data refresh on reconnection

**Changes:**
```javascript
// Enhanced API function
async function api(path, options = {}) {
  try {
    const response = await fetch(path, { ... });
    
    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const data = await response.json().catch(() => ({}));
        errorMsg = data.error || data.message || errorMsg;
        if (data.hint) errorMsg += ` - ${data.hint}`;
      } catch (_) {}
      
      const error = new Error(errorMsg);
      error.status = response.status;
      throw error;
    }
    
    return await response.json().catch(() => ({}));
    
  } catch (error) {
    // Handle fetch errors
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      throw new Error('Network error: Failed to connect to the server. Check if the backend is running and your internet connection is active.');
    }
    throw error;
  }
}

// Enhanced error reporting
function reportError(error) {
  let message = error?.message || String(error);
  
  if (error?.type === 'NETWORK_ERROR' || message.includes('Failed to fetch')) {
    message = 'Network error: Unable to connect to the server. Please check if the backend is running and your internet connection is active.';
  } else if (error?.type === 'TIMEOUT_ERROR' || message.includes('timeout')) {
    message = 'Request timed out. Please check your internet connection and try again.';
  } else if (message.includes('ECONNREFUSED')) {
    message = 'Connection refused: The backend server is not running or not accessible.';
  } else if (message.includes('SSL') || message.includes('TLS')) {
    message = 'SSL/TLS error: Security certificate issue. This might be a temporary network problem.';
  }
  
  setBusy(false, 'Error');
  log(message, 'error');
  notify(message, 'error');
}

// Enhanced EventSource with reconnection
function connectEvents() {
  let source = null;
  let reconnectTimer = null;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAY_MS = 3000;
  let reconnectAttempts = 0;
  
  function setupEventSource() {
    // ... setup with error handling and reconnection logic
  }
  
  setupEventSource();
}

// Online/offline state tracking
function setOnline(online) {
  // ... existing code
  if (online && !state.onlineWasOnline) {
    state.onlineWasOnline = true;
    if (state.pendingRefresh) {
      state.pendingRefresh = false;
      loadVersions().catch(() => {});
      loadAccounts().catch(() => {});
      loadStatus().catch(() => {});
    }
  } else if (!online) {
    state.onlineWasOnline = false;
    state.pendingRefresh = true;
  }
}
```

## Key Improvements

### 1. **Better Error Classification**
- Network errors are now properly identified and classified as retryable
- SSL/TLS errors are automatically retried
- Timeout errors are handled gracefully
- JSON parsing errors provide clear feedback

### 2. **Automatic Retry Logic**
- All fetch operations now have built-in retry mechanisms
- Exponential backoff prevents overwhelming servers
- Retryable errors are automatically identified

### 3. **Improved User Feedback**
- Detailed status messages are emitted via the progress bus
- Frontend receives clear, actionable error messages
- Network issues are distinguished from server errors

### 4. **Resilient Connections**
- EventSource connections automatically reconnect
- CORS headers ensure frontend-backend communication works
- Online/offline state is properly tracked

### 5. **Graceful Degradation**
- When primary APIs fail, fallback mechanisms are used
- Cached data is used when available
- Partial failures don't break the entire application

## Testing Recommendations

1. **Test offline scenarios** - Verify graceful error messages when no internet connection
2. **Test API failures** - Simulate API outages to verify fallback behavior
3. **Test network instability** - Use tools like `tc` (traffic control) to simulate packet loss
4. **Test SSL/TLS issues** - Verify behavior with self-signed certificates
5. **Test rate limiting** - Verify 429 responses are handled properly

## Common Error Scenarios Now Handled

| Scenario | Previous Behavior | New Behavior |
|----------|------------------|--------------|
| Mojang API down | Generic error | Falls back to alternative manifest URL, then cached data |
| Fabric API timeout | Generic error | Retries with exponential backoff, clear status message |
| Network disconnect | Generic error | Clear "Network error" message with reconnection logic |
| SSL certificate issue | Generic error | Retries, provides SSL-specific error message |
| CurseForge API key missing | Generic error | Clear message about configuring API key |
| EventSource disconnect | No reconnection | Automatic reconnection with backoff |
| JSON parse error | Generic error | Clear message about data format issue |

## Configuration Tips

1. **Set CURSEFORGE_API_KEY** - Get a key from https://console.curseforge.com/ and set the environment variable
2. **Configure RESOURCES_MIRRORS** - Add local mirrors in config.js if Minecraft resources are slow
3. **Increase timeout values** - For slow connections, consider increasing DEFAULT_TIMEOUT_MS in downloader.js

## Backward Compatibility

All changes are backward compatible. Existing installations will continue to work, and the improvements are additive rather than breaking.