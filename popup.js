document.getElementById("loginSpotify").addEventListener("click", loginSpotify);
document.getElementById("loginYouTube").addEventListener("click", loginYouTube);
document.addEventListener('DOMContentLoaded', function() {
  checkLoginStatus();
});

const spotifyClientId = SECRETS.SPOTIFY_CLIENT_ID;
const googleClientId = SECRETS.GOOGLE_CLIENT_ID;

// --- PKCE Utilities ---
function base64urlencode(str) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return await window.crypto.subtle.digest('SHA-256', data);
}

async function generateCodeChallenge(codeVerifier) {
  const hashed = await sha256(codeVerifier);
  return base64urlencode(hashed);
}

function generateCodeVerifier(length = 128) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let verifier = '';
  for (let i = 0; i < length; i++) {
    verifier += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return verifier;
}

// --- Spotify PKCE Login ---
async function loginSpotify() {
  const clientId = spotifyClientId;
  const redirectUri = chrome.identity.getRedirectURL();
  const scopes = ["playlist-read-private", "playlist-read-collaborative"];

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  // Store the codeVerifier for later token exchange
  chrome.storage.local.set({ spotifyPKCEVerifier: codeVerifier });

  const authUrl =
    `https://accounts.spotify.com/authorize` +
    `?client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes.join("%20")}` +
    `&code_challenge_method=S256` +
    `&code_challenge=${codeChallenge}`;

  console.log("Spotify PKCE Auth URL:", authUrl);
  console.log("Redirect URI:", redirectUri);

  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
    if (chrome.runtime.lastError || !responseUrl) {
      console.error("Spotify login error:", chrome.runtime.lastError);
      alert("Spotify login failed: " + (chrome.runtime.lastError?.message || "Unknown error"));
      return;
    }
    console.log("Spotify response URL:", responseUrl);
    if (responseUrl.includes("error=")) {
      const urlParams = new URLSearchParams(responseUrl.split("?")[1] || responseUrl.split("#")[1]);
      const error = urlParams.get("error");
      console.error("OAuth error:", error);
      alert("Spotify login failed: " + error);
      return;
    }
    const urlParams = new URLSearchParams(responseUrl.split("?code=")[1]);
    const code = urlParams.get("code") || responseUrl.split("?code=")[1];
    if (!code) {
      alert("No authorization code received from Spotify");
      return;
    }
    // Exchange code for token
    exchangeSpotifyCodeForToken(code, redirectUri);
  });
}

function exchangeSpotifyCodeForToken(code, redirectUri) {
  chrome.storage.local.get(['spotifyPKCEVerifier'], function(result) {
    const codeVerifier = result.spotifyPKCEVerifier;
    if (!codeVerifier) {
      alert("PKCE code verifier not found. Please try logging in again.");
      return;
    }
    const clientId = spotifyClientId;
    const data = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });
    fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: data
    })
      .then(res => res.json())
      .then(tokenData => {
        if (tokenData.error) {
          alert('Spotify token exchange failed: ' + tokenData.error_description);
          return;
        }
        chrome.storage.local.set({ spotifyAccessToken: tokenData.access_token }, () => {
          document.getElementById("status").textContent = "Spotify Logged In";
          testSpotifyToken(tokenData.access_token);
          fetchSpotifyPlaylists(tokenData.access_token);
        });
      })
      .catch(err => {
        alert('Spotify token exchange error: ' + err.message);
      });
  });
}

function loginYouTube() {
  const clientId = googleClientId;
  const redirectUri = chrome.identity.getRedirectURL();
  const scope = "https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl";

  const authUrl =
    `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent(scope)}` +
    `&include_granted_scopes=true`;

  console.log("YouTube Auth URL:", authUrl);
  console.log("YouTube Redirect URI:", redirectUri);

  chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
    if (chrome.runtime.lastError || !responseUrl) {
      console.error("YouTube login error:", chrome.runtime.lastError);
      alert("YouTube login failed: " + (chrome.runtime.lastError?.message || "Unknown error"));
      return;
    }
    
    console.log("YouTube response URL:", responseUrl);
    
    if (responseUrl.includes("error=")) {
      const urlParams = new URLSearchParams(responseUrl.split("?")[1] || responseUrl.split("#")[1]);
      const error = urlParams.get("error");
      console.error("OAuth error:", error);
      alert("YouTube login failed: " + error);
      return;
    }
    
    const urlParams = new URLSearchParams(responseUrl.split("#")[1]);
    const accessToken = urlParams.get("access_token");
    const error = urlParams.get("error");
    
    if (error) {
      console.error("OAuth error:", error);
      alert("YouTube login failed: " + error);
      return;
    }
    
    if (!accessToken) {
      console.error("No access token received");
      alert("No access token received from YouTube");
      return;
    }
    
    chrome.storage.local.set({ youtubeAccessToken: accessToken }, () => {
      document.getElementById("status").textContent += " & YouTube Logged In";
      testYouTubeToken(accessToken);
    });
  });
}

function testSpotifyToken(token) {
  console.log("Testing Spotify token:", token ? token.substring(0, 20) + "..." : "No token");
  
  fetch("https://api.spotify.com/v1/me", {
    headers: { 
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  })
    .then(res => {
      console.log("Token test response status:", res.status);
      return res.json();
    })
    .then(data => {
      console.log("Token test response:", data);
      if (data.error) {
        console.error("Spotify API error:", data.error);
        alert("Token error: " + data.error.message);
        clearTokens();
      } else {
        console.log("Token is valid! User:", data.display_name);
      }
    })
    .catch(err => {
      console.error("Token test failed:", err);
    });
}

function testYouTubeToken(token) {
  console.log("Testing YouTube token:", token ? token.substring(0, 20) + "..." : "No token");
  
  fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { 
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  })
    .then(res => {
      console.log("YouTube token test response status:", res.status);
      return res.json();
    })
    .then(data => {
      console.log("YouTube token test response:", data);
      if (data.error) {
        console.error("YouTube API error:", data.error);
        alert("YouTube token error: " + data.error.message);
        clearTokens();
      } else {
        console.log("YouTube token is valid! User:", data.items?.[0]?.snippet?.title || "Unknown");
      }
    })
    .catch(err => {
      console.error("YouTube token test failed:", err);
    });
}

function fetchSpotifyPlaylists(token) {
  console.log("Fetching playlists with token:", token ? "Token exists" : "No token");
  console.log("Token length:", token ? token.length : 0);
  console.log("Token starts with:", token ? token.substring(0, 10) : "No token");
  
  const headers = { 
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  
  console.log("Request headers:", headers);
  
  fetch("https://api.spotify.com/v1/me/playlists", {
    headers: headers
  })
    .then(res => {
      console.log("Playlists response status:", res.status);
      console.log("Response headers:", res.headers);
      
      if (!res.ok) {
        // Get the error response body for more details
        return res.text().then(text => {
          console.log("Error response body:", text);
          throw new Error(`HTTP error! status: ${res.status}, body: ${text}`);
        });
      }
      return res.json();
    })
    .then(data => {
      console.log("Spotify API response:", data);
      
      const container = document.getElementById("playlistContainer");
      container.innerHTML = "";
      
      if (!data) {
        console.error("No data received from Spotify API");
        container.innerHTML = "<p>No data received from Spotify</p>";
        return;
      }
      
      if (!data.items || !Array.isArray(data.items)) {
        console.error("Invalid response structure:", data);
        container.innerHTML = "<p>Invalid response from Spotify API</p>";
        return;
      }
      
      if (data.items.length === 0) {
        container.innerHTML = "<p>No playlists found</p>";
        return;
      }
      
      // Store playlists for Sync All
      const playlists = data.items.map(p => ({ id: p.id, name: p.name }));
      
      // Add Sync All button if not already present
      let syncAllBtn = document.getElementById('syncAllBtn');
      if (!syncAllBtn) {
        syncAllBtn = document.createElement('button');
        syncAllBtn.id = 'syncAllBtn';
        syncAllBtn.textContent = 'Sync All Playlists';
        syncAllBtn.className = 'login-btn spotify-btn';
        syncAllBtn.style.marginBottom = '10px';
        syncAllBtn.onclick = () => syncAllPlaylists(playlists);
        container.parentNode.insertBefore(syncAllBtn, container);
      } else {
        // Update the onclick in case playlists changed
        syncAllBtn.onclick = () => syncAllPlaylists(playlists);
      }
      
      // Render playlist buttons
      playlists.forEach((playlist) => {
        const btn = document.createElement("button");
        btn.textContent = `${playlist.name} - Sync`;
        btn.onclick = () => syncPlaylistToYouTube(playlist.id, playlist.name, () => {
          console.log(`Finished syncing ${playlist.name}`);
        });
        container.appendChild(btn);
      });
    })
    .catch(err => {
      console.error("Failed to fetch playlists:", err);
      const container = document.getElementById("playlistContainer");
      container.innerHTML = `<p>Error fetching playlists: ${err.message}</p>`;
      
      if (err.message.includes("401")) {
        console.error("401 Unauthorized - Token is invalid or expired");
        alert("Token expired or invalid. Please login again.");
        clearTokens();
      }
    });
}

function syncAllPlaylists(playlists) {
  if (!Array.isArray(playlists) || playlists.length === 0) {
    alert("No playlists to sync.");
    return;
  }
  
  // Check if both tokens are available
  chrome.storage.local.get(['spotifyAccessToken', 'youtubeAccessToken'], function(result) {
    if (!result.spotifyAccessToken || !result.youtubeAccessToken) {
      alert("Please login to both Spotify and YouTube first.");
      return;
    }
    
    // Show progress bar
    const progressContainer = document.getElementById("progressBarContainer");
    const progressBar = document.getElementById("progressBar");
    const status = document.getElementById("status");
    
    progressContainer.style.display = "block";
    status.textContent = "Starting sync...";
    
    let completed = 0;
    const total = playlists.length;
    
    // Sync playlists sequentially
    const syncNext = (index) => {
      if (index >= playlists.length) {
        status.textContent = "All playlists synced successfully!";
        progressContainer.style.display = "none";
        return;
      }
      
      const playlist = playlists[index];
      const progress = ((index + 1) / total) * 100;
      progressBar.style.width = progress + "%";
      status.textContent = `Syncing ${playlist.name}... (${index + 1}/${total})`;
      
      syncPlaylistToYouTube(playlist.id, playlist.name, () => {
        completed++;
        if (completed === total) {
          status.textContent = "All playlists synced successfully!";
          progressContainer.style.display = "none";
        } else {
          syncNext(index + 1);
        }
      });
    };
    
    syncNext(0);
  });
}

async function syncPlaylistToYouTube(playlistId, playlistName, callback) {
  try {
    // Get tokens
    const tokens = await new Promise((resolve) => {
      chrome.storage.local.get(['spotifyAccessToken', 'youtubeAccessToken'], resolve);
    });
    
    if (!tokens.spotifyAccessToken || !tokens.youtubeAccessToken) {
      alert("Please login to both Spotify and YouTube first.");
      if (callback) callback();
      return;
    }
    
    console.log(`Starting sync for playlist: ${playlistName} (${playlistId})`);
    
    // 1. Fetch Spotify playlist tracks
    const spotifyTracks = await fetchSpotifyPlaylistTracks(playlistId, tokens.spotifyAccessToken);
    console.log(`Found ${spotifyTracks.length} tracks in Spotify playlist`);
    
    if (spotifyTracks.length === 0) {
      console.log("No tracks found in playlist");
      if (callback) callback();
      return;
    }
    
    // 2. Create or find YouTube playlist
    const youtubePlaylistId = await createOrFindYouTubePlaylist(playlistName, tokens.youtubeAccessToken);
    console.log(`YouTube playlist ID: ${youtubePlaylistId}`);
    
    // 3. Search and add tracks to YouTube playlist
    let addedCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < spotifyTracks.length; i++) {
      const track = spotifyTracks[i];
      try {
        // Update status for current track
        const status = document.getElementById("status");
        status.textContent = `Processing: ${track.name} by ${track.artist} (${i + 1}/${spotifyTracks.length})`;
        
        const searchQuery = `${track.name} ${track.artist}`;
        const videoId = await searchYouTubeVideo(searchQuery, tokens.youtubeAccessToken);
        
        if (videoId) {
          const added = await addVideoToYouTubePlaylist(youtubePlaylistId, videoId, tokens.youtubeAccessToken);
          if (added) {
            addedCount++;
            console.log(`Added: ${track.name} by ${track.artist}`);
          }
        } else {
          notFoundCount++;
          console.log(`No YouTube video found for: ${track.name} by ${track.artist}`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        errorCount++;
        console.error(`Error processing track ${track.name}:`, error);
        
        // If it's a quota error, stop processing
        if (error.message.includes("quota exceeded")) {
          alert("YouTube API quota exceeded. Please try again later.");
          break;
        }
      }
    }
    
    // Final status update
    const status = document.getElementById("status");
    status.textContent = `Sync completed: ${addedCount} added, ${notFoundCount} not found, ${errorCount} errors`;
    
    console.log(`Sync completed: ${addedCount}/${spotifyTracks.length} tracks added to YouTube playlist`);
    if (callback) callback();
    
  } catch (error) {
    console.error("Sync error:", error);
    alert(`Error syncing playlist: ${error.message}`);
    if (callback) callback();
  }
}

async function fetchSpotifyPlaylistTracks(playlistId, token) {
  const tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
  
  while (url) {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
    
    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    for (const item of data.items) {
      if (item.track && item.track.name) {
        tracks.push({
          name: item.track.name,
          artist: item.track.artists.map(a => a.name).join(", "),
          album: item.track.album.name
        });
      }
    }
    
    url = data.next;
  }
  
  return tracks;
}

async function createOrFindYouTubePlaylist(name, token) {
  // First, try to find existing playlist
  const searchResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50`,
    {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );
  
  if (searchResponse.ok) {
    const data = await searchResponse.json();
    const existingPlaylist = data.items.find(p => p.snippet.title === name);
    if (existingPlaylist) {
      console.log("Found existing playlist:", existingPlaylist.id);
      return existingPlaylist.id;
    }
  }
  
  // Create new playlist
  const createResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/playlists?part=snippet,status`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        snippet: {
          title: name,
          description: `Synced from Spotify playlist: ${name}`
        },
        status: {
          privacyStatus: "private"
        }
      })
    }
  );
  
  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Failed to create YouTube playlist: ${createResponse.status} - ${errorText}`);
  }
  
  const playlistData = await createResponse.json();
  console.log("Created new playlist:", playlistData.id);
  return playlistData.id;
}

async function searchYouTubeVideo(query, token) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=1&videoCategoryId=10`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("YouTube search failed:", response.status, errorText);
      
      // Check for quota exceeded error
      if (response.status === 403) {
        const errorData = JSON.parse(errorText);
        if (errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
          throw new Error("YouTube API quota exceeded. Please try again later.");
        }
      }
      
      return null;
    }
    
    const data = await response.json();
    if (data.items && data.items.length > 0) {
      return data.items[0].id.videoId;
    }
    
    return null;
  } catch (error) {
    console.error("YouTube search error:", error);
    throw error;
  }
}

async function addVideoToYouTubePlaylist(playlistId, videoId, token) {
  // First check if video is already in playlist
  const checkResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&videoId=${videoId}`,
    {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );
  
  if (checkResponse.ok) {
    const checkData = await checkResponse.json();
    if (checkData.items && checkData.items.length > 0) {
      console.log("Video already in playlist, skipping");
      return false;
    }
  }
  
  // Add video to playlist
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        snippet: {
          playlistId: playlistId,
          resourceId: {
            kind: "youtube#video",
            videoId: videoId
          }
        }
      })
    }
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to add video to playlist:", response.status, errorText);
    return false;
  }
  
  return true;
}

function clearTokens() {
  chrome.storage.local.remove(['spotifyAccessToken', 'youtubeAccessToken'], () => {
    console.log("Tokens cleared");
    document.getElementById("status").textContent = "Please log in to both services.";
    document.getElementById("playlistContainer").innerHTML = "";
  });
}

function checkLoginStatus() {
  chrome.storage.local.get(['spotifyAccessToken', 'youtubeAccessToken'], function(result) {
    let status = "Please log in to both services.";
    
    if (result.spotifyAccessToken) {
      status = "Spotify Logged In";
      fetchSpotifyPlaylists(result.spotifyAccessToken);
    }
    
    if (result.youtubeAccessToken) {
      status += " & YouTube Logged In";
      testYouTubeToken(result.youtubeAccessToken);
    }
    
    document.getElementById("status").textContent = status;
  });
}

// Add clear tokens button for debugging
function addClearButton() {
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear Tokens";
  clearBtn.onclick = clearTokens;
  clearBtn.style.marginTop = "10px";
  document.body.appendChild(clearBtn);
}

// Add clear button for development
addClearButton();

// Add this function at the end of the file for manual testing
function manualTokenTest() {
  chrome.storage.local.get(['spotifyAccessToken'], function(result) {
    if (result.spotifyAccessToken) {
      console.log("Testing stored token manually...");
      console.log("Token:", result.spotifyAccessToken);
      console.log("Token length:", result.spotifyAccessToken.length);
      
      // Test with curl-like request
      fetch("https://api.spotify.com/v1/me", {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${result.spotifyAccessToken}`,
          'Content-Type': 'application/json'
        }
      })
      .then(response => {
        console.log("Manual test response status:", response.status);
        console.log("Response ok:", response.ok);
        return response.text();
      })
      .then(text => {
        console.log("Manual test response body:", text);
        try {
          const data = JSON.parse(text);
          console.log("Parsed response:", data);
        } catch (e) {
          console.log("Response is not JSON");
        }
      })
      .catch(error => {
        console.error("Manual test failed:", error);
      });
    } else {
      console.log("No stored token found");
    }
  });
}

// Make it available globally for console testing
window.manualTokenTest = manualTokenTest;

// Debug function to test sync functionality
window.debugSync = async function() {
  console.log("=== Debug Sync Function ===");
  
  // Check tokens
  const tokens = await new Promise((resolve) => {
    chrome.storage.local.get(['spotifyAccessToken', 'youtubeAccessToken'], resolve);
  });
  
  console.log("Spotify token exists:", !!tokens.spotifyAccessToken);
  console.log("YouTube token exists:", !!tokens.youtubeAccessToken);
  
  if (!tokens.spotifyAccessToken || !tokens.youtubeAccessToken) {
    console.error("Missing tokens - please login to both services");
    return;
  }
  
  // Test Spotify API
  try {
    const spotifyResponse = await fetch("https://api.spotify.com/v1/me/playlists?limit=1", {
      headers: { "Authorization": `Bearer ${tokens.spotifyAccessToken}` }
    });
    console.log("Spotify API test:", spotifyResponse.status, spotifyResponse.ok);
  } catch (error) {
    console.error("Spotify API test failed:", error);
  }
  
  // Test YouTube API
  try {
    const youtubeResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { "Authorization": `Bearer ${tokens.youtubeAccessToken}` }
    });
    console.log("YouTube API test:", youtubeResponse.status, youtubeResponse.ok);
  } catch (error) {
    console.error("YouTube API test failed:", error);
  }
  
  console.log("=== Debug Complete ===");
};

// Add this function after the loginYouTube function
function exchangeCodeForToken(code, redirectUri) {
  console.log("Exchanging code for token:", code.substring(0, 10) + "...");
  
  // For Chrome extensions, we need to use a different approach
  // Since we can't make server-side requests, we'll use a simple method
  // This is a basic implementation - you might need to adjust based on your needs
  
  const tokenUrl = "https://accounts.spotify.com/api/token";
  const clientId = spotifyClientId;
  
  // Note: This won't work directly in the browser due to CORS
  // You'll need to either:
  // 1. Use a proxy server
  // 2. Configure your Spotify app for implicit flow
  // 3. Use a different approach
  
  console.log("Token exchange URL:", tokenUrl);
  console.log("Client ID:", clientId);
  console.log("Redirect URI:", redirectUri);
  
  alert("Token exchange not implemented for browser security reasons.\n\nPlease configure your Spotify app to support implicit flow (response_type=token) or implement a server-side token exchange.");
}

// Update the code handling in loginSpotify
function handleAuthorizationCode(code) {
  console.log("Handling authorization code:", code.substring(0, 10) + "...");
  
  // For now, we'll just store the code and ask user to implement exchange
  chrome.storage.local.set({ spotifyAuthCode: code }, () => {
    document.getElementById("status").textContent = "Spotify Code Received - Need Token Exchange";
    alert(`Authorization code received and stored.\n\nCode: ${code.substring(0, 10)}...\n\nYou need to implement token exchange or configure your Spotify app for implicit flow.`);
  });
}