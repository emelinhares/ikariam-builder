// Background Service Worker
// Gerencia storage, notificações e comunicação entre tabs

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.cmd === 'notify') {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: msg.title || 'Auto Builder',
            message: msg.body || ''
        });
    }
    return false;
});
