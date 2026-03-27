// DevTrace background service worker v3.0.5
const DEVTRACE_DEBUG = false;
const debugLog = (...args) => {
    if (DEVTRACE_DEBUG) {
        console.log(...args);
    }
};
const DEFAULT_BLOCKED_DOMAINS = [
    // Core Google / tracking
    'doubleclick.net',
    'googlesyndication.com',
    'googletagmanager.com',
    'facebook.com/tr',
    'google-analytics.com',
    'googleadservices.com',
    'cdn.cookielaw.org',
    'cdn.jsdelivr.net',
    'analytics.google.com',
    'google.com',
    'www.google.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    // From user screenshot - common ad / tracking / DSP / CDN helper domains
    'match.adsrvr.org',
    'adsrvr.org',
    'x.bidswitch.net',
    'bidswitch.net',
    'stackadapt.com',
    'srv.stackadapt.com',
    'sync.srv.stackadapt.com',
    'teads.tv',
    'sync.teads.tv',
    'criteo.com',
    'px.ads.linkedin.com',
    'linkedin.com',
    'gstatic.com',
    'tracking.prismpartner.smt.docomo.ne.jp',
    'prismpartner.smt.docomo.ne.jp',
    'pr-bh.ybp.yahoo.com',
    'yahoo.com',
    'creativecdn.com',
    'temu.com',
    'rtb2-useast.voisetech.com',
    'voisetech.com',
    'ep1.adtrafficquality.google',
    'ep2.adtrafficquality.google',
    'adtrafficquality.google',
    'pixel.rnt-us-dsp-api.molocoo.com',
    'molocoo.com',
    // Additional from provided list
    '2mdn.net',
    'simpli.fi',
    'zemanta.com',
    'admaster.cc',
    'tribalfusion.com',
    'ladsp.com',
    'bidr.io',
    'mediago.io',
    'popin.cc',
    'outbrain.com',
    'appier.net',
    'adster.tech',
    'quantserve.com',
    'dotomi.com',
    'advolve.io',
    'gsspat.jp',
    'moloco.com',
    'googlevideo.com',
    'ytimg.com',
    'ggpht.com',
    // Newly requested additions
    'dynalyst-sync.adtdp.com',
    'adtdp.com',
    'ads.travelaudience.com',
    'travelaudience.com',
    'mweb.ck.inmobi.com',
    'inmobi.com',
    // Additional user requested blocking
    'fout.jp',
    'sync.fout.jp',
    // Newly requested domains
    'static.googleadsserving.cn',
    'googleadsserving.cn',
    'ib.adnxs.com',
    'adnxs.com',
    'sync-tm.everesttech.net',
    'everesttech.net',
    'us-u.openx.net',
    'ipac.ctnsnet.com',
    'dsp.adkernel.com',
    'c1.adform.net',
    'dzc-v6exp3-ds.metric.ipv6test.net'
];

let captureState = {
    isCapturing: false,
    // in-memory current domain requests mirror (for popup quick access)
    capturedRequests: [],
    // sessions persisted per domain: { [domain]: { requests:[], urlSet:[], requestCounter:number, lastUpdated:number } }
    sessions: {},
    settings: {
        maxRequests: 1000,
        saveDetails: false,
        blockAds: true,
        blockStatic: false,
        defaultView: 'popup',
        captureMode: 'all_domains',
        allowedDomains: [],
        blockedDomains: [...DEFAULT_BLOCKED_DOMAINS]
    },
    targetDomain: null,
    requestCounter: 0
};

// Debounce write timer
let persistTimer = null;

async function loadPersistedState() {
    return new Promise(resolve => {
        chrome.storage.local.get(['captureSessions','captureGlobal','captureSettings'], (res) => {
            try {
                if (res.captureSettings) {
                    captureState.settings = { ...captureState.settings, ...res.captureSettings };
                }
                if (res.captureGlobal) {
                    captureState.isCapturing = !!res.captureGlobal.isCapturing;
                    captureState.targetDomain = res.captureGlobal.targetDomain || null;
                }
                if (res.captureSessions) {
                    // revive sessions; convert urlSet array to Set later on demand
                    captureState.sessions = res.captureSessions;
                }
                // hydrate current domain mirror
                if (captureState.targetDomain && captureState.sessions[captureState.targetDomain]) {
                    const sess = captureState.sessions[captureState.targetDomain];
                    captureState.capturedRequests = sess.requests || [];
                    captureState.requestCounter = sess.requestCounter || captureState.capturedRequests.length;
                }
                // After hydration ensure newly added default blocked domains are pruned
                pruneBlockedFromCurrentSession();
            } catch(e) {
                console.error('Failed loading persisted state', e);
            }
            resolve();
        });
    });
}

function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 600);
}

function persistNow() {
    persistTimer = null;
    try {
        const serializableSessions = {};
        for (const [domain, sess] of Object.entries(captureState.sessions)) {
            serializableSessions[domain] = {
                ...sess,
                // convert Set to array for storage
                urlSet: Array.isArray(sess.urlSet) ? sess.urlSet : Array.from(sess.urlSet || [])
            };
        }
        chrome.storage.local.set({
            captureSessions: serializableSessions,
            captureGlobal: {
                isCapturing: captureState.isCapturing,
                targetDomain: captureState.targetDomain
            },
            captureSettings: captureState.settings
        });
    } catch(e) {
        console.error('Persist error', e);
    }
}

// 窗口管理
let captureWindow = null;

// 广告和追踪域名黑名单
const AD_DOMAINS = [
    'doubleclick.net', 'googlesyndication.com', 'googletagmanager.com',
    'google-analytics.com', 'googleadservices.com', 'facebook.com',
    'amazon-adsystem.com', 'adsystem.amazon.com', 'scorecardresearch.com'
];

// 静态资源类型
const STATIC_TYPES = ['image', 'stylesheet', 'font', 'media'];

// 初始化存储设置
chrome.runtime.onInstalled.addListener(() => {
    loadSettings();
});

// Service worker startup restore
loadPersistedState().then(() => {
    if (captureState.isCapturing && captureState.targetDomain) {
        ensureListenersActive();
        debugLog('[Restore] Active capturing restored for', captureState.targetDomain, 'requests:', captureState.capturedRequests.length);
    }
    // Ensure newly added default blocked domains merged even if settings already loaded earlier
    const setBefore = new Set(captureState.settings.blockedDomains || []);
    let changed = false;
    for (const d of DEFAULT_BLOCKED_DOMAINS) { if (!setBefore.has(d)) { setBefore.add(d); changed = true; } }
    if (changed) {
        captureState.settings.blockedDomains = Array.from(setBefore);
        saveSettings();
        pruneBlockedFromCurrentSession();
        debugLog('[Merge] Added new default blocked domains. Total now:', captureState.settings.blockedDomains.length);
    }
    // Second pass merge to ensure newly appended domains (if patch updated constant during active session)
    const setCheck = new Set(captureState.settings.blockedDomains || []);
    let changed2 = false;
    for (const d2 of DEFAULT_BLOCKED_DOMAINS) { if (!setCheck.has(d2)) { setCheck.add(d2); changed2 = true; } }
    if (changed2) {
        captureState.settings.blockedDomains = Array.from(setCheck);
        saveSettings();
        pruneBlockedFromCurrentSession();
        debugLog('[Merge] Second-pass merge applied. Total now:', captureState.settings.blockedDomains.length);
    }
    // Final prune to ensure newly added fout.jp removal
    pruneBlockedFromCurrentSession();
});

// 消息处理器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        switch (request.message) {
            case 'start_capture':
                handleStartCapture(request, sendResponse);
                break;
            case 'stop_capture':
                handleStopCapture(sendResponse);
                break;
            case 'get_captured_data':
                {
                    let requests = captureState.capturedRequests;
                    if (captureState.targetDomain && captureState.sessions[captureState.targetDomain]) {
                        requests = captureState.sessions[captureState.targetDomain].requests || [];
                    }
                    sendResponse({ 
                        requests,
                        total: captureState.requestCounter,
                        isCapturing: captureState.isCapturing,
                        targetDomain: captureState.targetDomain
                    });
                }
                break;
            case 'clear_requests':
                handleClearRequests(sendResponse);
                break;
            case 'reset_session':
                handleResetSession(sendResponse);
                break;
            case 'update_settings':
                handleUpdateSettings(request.settings, sendResponse);
                break;
            case 'get_settings':
                sendResponse({ settings: captureState.settings });
                break;
            case 'add_blocked_domain':
                handleAddBlockedDomain(request.domain, sendResponse);
                break;
            case 'remove_blocked_domain':
                handleRemoveBlockedDomain(request.domain, sendResponse);
                break;
            case 'close_window':
                handleCloseWindow(sendResponse);
                break;
            case 'minimize_window':
                handleMinimizeWindow(sendResponse);
                break;
            case 'open_window':
                handleOpenWindow(sendResponse);
                break;
            default:
                sendResponse({ error: 'Unknown message type' });
        }
    } catch (error) {
        console.error('Background script error:', error);
        sendResponse({ error: error.message });
    }
    return true; // 保持消息通道开放
});

// 开始捕获请求
async function handleStartCapture(request, sendResponse) {
    try {
        if (!request.url || !request.url.trim()) {
            throw new Error('URL is required');
        }

        let targetUrl;
        try {
            targetUrl = new URL(request.url);
        } catch (urlError) {
            throw new Error('Invalid URL format. Please check the URL and try again.');
        }

        // 根据捕获模式决定监听的URL模式
        const captureMode = captureState.settings.captureMode || 'all_domains';
        let urls;
        
        switch (captureMode) {
            case 'main_domain_only':
                urls = [`${targetUrl.protocol}//${targetUrl.host}/*`];
                break;
            case 'include_subdomains':
                urls = [`${targetUrl.protocol}//*.${targetUrl.hostname}/*`, `${targetUrl.protocol}//${targetUrl.host}/*`];
                break;
            case 'all_domains':
            case 'whitelist':
                urls = ["<all_urls>"]; // 监听所有URL，在shouldCaptureRequest中进行过滤
                break;
            default:
                urls = [`${targetUrl.protocol}//${targetUrl.host}/*`];
        }

        // 请求权限
        const granted = await chrome.permissions.request({
            origins: urls
        });

        if (!granted) {
            throw new Error('Permission denied for this domain');
        }

        const newDomain = targetUrl.hostname;
        const switchingDomain = captureState.targetDomain && captureState.targetDomain !== newDomain;

        captureState.isCapturing = true;
        captureState.targetDomain = newDomain;

        // 每次点击 Start 都从该域名的全新会话开始
        captureState.sessions[newDomain] = {
            requests: [],
            urlSet: new Set(),
            requestCounter: 0,
            lastUpdated: Date.now()
        };

        if (switchingDomain) {
            // when switching domain we keep previous in sessions intact; reset in-memory mirror to new domain session
            debugLog('[Start] Switching from', captureState.targetDomain, 'to', newDomain);
        }

        // Mirror current domain session into top-level convenience fields
        captureState.capturedRequests = captureState.sessions[newDomain].requests;
        captureState.requestCounter = captureState.sessions[newDomain].requestCounter;
        schedulePersist();
        notifyPopupUpdate();

        // 添加请求监听器 - 根据模式监听不同范围的请求
        chrome.webRequest.onBeforeRequest.addListener(
            handleWebRequest,
            { urls: urls },
            ["requestBody"]
        );

        // 添加响应监听器以获取状态码和响应头
        chrome.webRequest.onCompleted.addListener(
            handleWebResponse,
            { urls: urls },
            ["responseHeaders"]
        );

        // 更新图标
        chrome.action.setIcon({ path: "icon48.png" });

        sendResponse({ 
            success: true, 
            targetDomain: captureState.targetDomain,
            captureMode: captureMode
        });

        debugLog(`Started capturing requests for domain: ${captureState.targetDomain} (mode: ${captureMode})`);
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// 停止捕获请求
function handleStopCapture(sendResponse) {
    try {
        captureState.isCapturing = false;
        
        // 移除监听器
        chrome.webRequest.onBeforeRequest.removeListener(handleWebRequest);
        chrome.webRequest.onCompleted.removeListener(handleWebResponse);
        
        // 恢复默认图标
        chrome.action.setIcon({ path: "default_icon48.png" });
        
        schedulePersist();
        sendResponse({ 
            success: true, 
            totalCaptured: captureState.requestCounter 
        });

        debugLog(`Stopped capturing. Total requests: ${captureState.requestCounter}`);
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// 清空请求数据
function handleClearRequests(sendResponse) {
    if (captureState.targetDomain && captureState.sessions[captureState.targetDomain]) {
        captureState.sessions[captureState.targetDomain].requests = [];
        captureState.sessions[captureState.targetDomain].urlSet = new Set();
        captureState.sessions[captureState.targetDomain].requestCounter = 0;
        captureState.sessions[captureState.targetDomain].lastUpdated = Date.now();
        captureState.capturedRequests = [];
        captureState.requestCounter = 0;
        schedulePersist();
    }
    sendResponse({ success: true });
}

function handleResetSession(sendResponse) {
    if (!captureState.targetDomain) {
        sendResponse({ success: false, error: 'No active domain' });
        return;
    }
    if (!captureState.sessions[captureState.targetDomain]) {
        captureState.sessions[captureState.targetDomain] = { requests: [], urlSet: new Set(), requestCounter:0, lastUpdated: Date.now() };
    } else {
        captureState.sessions[captureState.targetDomain].requests = [];
        captureState.sessions[captureState.targetDomain].urlSet = new Set();
        captureState.sessions[captureState.targetDomain].requestCounter = 0;
        captureState.sessions[captureState.targetDomain].lastUpdated = Date.now();
    }
    captureState.capturedRequests = [];
    captureState.requestCounter = 0;
    schedulePersist();
    notifyPopupUpdate();
    sendResponse({ success: true });
}

// 更新设置
function handleUpdateSettings(newSettings, sendResponse) {
    try {
        captureState.settings = { ...captureState.settings, ...newSettings };
        saveSettings();
        // prune existing data against updated block list
        pruneBlockedFromCurrentSession();
        sendResponse({ success: true });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// 添加域名到黑名单
function handleAddBlockedDomain(domain, sendResponse) {
    try {
        if (!domain || typeof domain !== 'string') {
            throw new Error('Invalid domain');
        }
        
        // 清理域名格式
        const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        
        // 检查是否已存在
        if (!captureState.settings.blockedDomains.includes(cleanDomain)) {
            captureState.settings.blockedDomains.push(cleanDomain);
            saveSettings();
            
            debugLog(`Added domain to blacklist: ${cleanDomain}`);
            debugLog('Current blacklist:', captureState.settings.blockedDomains);
            sendResponse({ 
                success: true, 
                domain: cleanDomain,
                blockedDomains: captureState.settings.blockedDomains 
            });
        } else {
            sendResponse({ 
                success: false, 
                error: 'Domain already in blacklist',
                blockedDomains: captureState.settings.blockedDomains 
            });
        }
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// 从黑名单移除域名
function handleRemoveBlockedDomain(domain, sendResponse) {
    try {
        const index = captureState.settings.blockedDomains.indexOf(domain);
        if (index > -1) {
            captureState.settings.blockedDomains.splice(index, 1);
            saveSettings();
            
            debugLog(`Removed domain from blacklist: ${domain}`);
            sendResponse({ 
                success: true, 
                domain: domain,
                blockedDomains: captureState.settings.blockedDomains 
            });
        } else {
            sendResponse({ 
                success: false, 
                error: 'Domain not found in blacklist',
                blockedDomains: captureState.settings.blockedDomains 
            });
        }
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// 处理Web请求
function handleWebRequest(details) {
    if (!captureState.isCapturing) return;

    try {
        const url = new URL(details.url);
        const domain = url.hostname;

        // 检查是否应该捕获此请求
        if (!shouldCaptureRequest(domain, details.type)) {
            return;
        }

        // 创建请求记录
        const requestRecord = {
            id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            url: details.url,
            method: details.method || 'GET',
            domain: domain,
            type: details.type || 'other',
            timestamp: Date.now(),
            initiator: details.initiator || 'unknown',
            status: 'pending' // 将在响应时更新
        };

        // 添加详细信息（如果启用）
        if (captureState.settings.saveDetails) {
            requestRecord.requestHeaders = details.requestHeaders || [];
            if (details.requestBody) {
                requestRecord.requestBody = details.requestBody;
            }
        }

        // 添加到捕获列表（FIFO策略）
        addRequestToCapture(requestRecord);

        // 通知popup更新
        notifyPopupUpdate();

    } catch (error) {
        console.error('Error processing web request:', error);
    }
}

// 处理Web响应
function handleWebResponse(details) {
    if (!captureState.isCapturing) return;

    try {
        // 查找对应的请求记录并更新状态
        const requestIndex = captureState.capturedRequests.findIndex(
            req => req.url === details.url && req.status === 'pending'
        );

        if (requestIndex !== -1) {
            captureState.capturedRequests[requestIndex].status = details.statusCode || 0;
            captureState.capturedRequests[requestIndex].size = getResponseSize(details.responseHeaders);
            if (captureState.settings.saveDetails) {
                captureState.capturedRequests[requestIndex].responseHeaders = details.responseHeaders || [];
            }
            schedulePersist();
            notifyPopupUpdate();
        }
    } catch (error) {
        console.error('Error processing web response:', error);
    }
}

function getResponseSize(responseHeaders = []) {
    const header = responseHeaders.find(item => item && item.name && item.name.toLowerCase() === 'content-length');
    if (!header || !header.value) return 0;

    const size = parseInt(header.value, 10);
    return Number.isFinite(size) ? size : 0;
}

// 检查是否应该捕获请求
function shouldCaptureRequest(domain, type) {
    // Block internal extension resources
    if (!domain && type === 'other') return false;
    if (domain && domain.startsWith('chrome-extension')) return false;
    // 新增：支持多种捕获模式
    const captureMode = captureState.settings.captureMode || 'main_domain_only';
    
    switch (captureMode) {
        case 'main_domain_only':
            // 原有模式：只捕获主域名
            if (domain !== captureState.targetDomain) {
                return false;
            }
            break;
            
        case 'include_subdomains':
            // 包含子域名模式
            if (!domain.endsWith(captureState.targetDomain) && domain !== captureState.targetDomain) {
                return false;
            }
            break;
            
        case 'all_domains':
            // 捕获所有域名（包括iframe和第三方资源）
            // 不进行域名过滤，捕获所有请求
            break;
            
        case 'whitelist':
            // 白名单模式：只捕获指定的域名列表
            const allowedDomains = captureState.settings.allowedDomains || [captureState.targetDomain];
            const isAllowed = allowedDomains.some(allowedDomain => 
                domain === allowedDomain || domain.endsWith('.' + allowedDomain)
            );
            if (!isAllowed) {
                return false;
            }
            break;
            
        default:
            // 默认只捕获主域名
            if (domain !== captureState.targetDomain) {
                return false;
            }
    }

    // 检查广告屏蔽
    if (captureState.settings.blockAds && isAdDomain(domain)) {
        return false;
    }

    // 检查静态资源屏蔽
    if (captureState.settings.blockStatic && STATIC_TYPES.includes(type)) {
        return false;
    }

    // 检查自定义屏蔽域名（精细：支持完整匹配和后缀匹配）
    const blockedList = captureState.settings.blockedDomains || [];
    const lowerDomain = domain.toLowerCase();
    if (blockedList.some(b => lowerDomain === b || lowerDomain.endsWith('.' + b) || lowerDomain.includes(b))) {
        // 针对 google.com 及其子域强制阻断
        if (/\.google\.com$/.test(lowerDomain) || lowerDomain === 'google.com' || lowerDomain.endsWith('.google.com')) {
            return false;
        }
        return false;
    }

    return true;
}

// 检查是否为广告域名
function isAdDomain(domain) {
    return AD_DOMAINS.some(adDomain => domain.includes(adDomain));
}

// 添加请求到捕获列表
function addRequestToCapture(requestRecord) {
    if (!captureState.targetDomain) return;
    const domain = captureState.targetDomain;
    const session = captureState.sessions[domain];
    if (!session) return;

    // Ensure urlSet is Set
    if (Array.isArray(session.urlSet)) session.urlSet = new Set(session.urlSet);

    if (session.urlSet.has(requestRecord.url)) return; // dedupe

    session.requests.push(requestRecord);
    session.urlSet.add(requestRecord.url);
    session.requestCounter++;
    session.lastUpdated = Date.now();

    // enforce maxRequests FIFO
    if (session.requests.length > captureState.settings.maxRequests) {
        const removed = session.requests.shift();
        if (removed && session.urlSet) {
            session.urlSet.delete(removed.url);
        }
    }

    // mirror
    captureState.capturedRequests = session.requests;
    captureState.requestCounter = session.requestCounter;
    schedulePersist();
}

// 通知popup更新数据
function notifyPopupUpdate() {
    // 节流：避免过于频繁的更新
    if (!notifyPopupUpdate.lastUpdate || Date.now() - notifyPopupUpdate.lastUpdate > 500) {
        chrome.runtime.sendMessage({
            type: 'data_updated',
            data: {
                requests: captureState.capturedRequests,
                total: captureState.requestCounter,
                isCapturing: captureState.isCapturing,
                targetDomain: captureState.targetDomain
            }
        }).catch(() => {
            // Popup可能已关闭，忽略错误
        });
        notifyPopupUpdate.lastUpdate = Date.now();
    }
}

// 加载设置
function loadSettings() {
    chrome.storage.local.get(['captureSettings'], (result) => {
        if (result.captureSettings) {
            // merge persisted settings
            captureState.settings = { ...captureState.settings, ...result.captureSettings };
            // ensure new default blocked domains are appended (migration-safe)
            const beforeSet = new Set(captureState.settings.blockedDomains || []);
            let changed = false;
            for (const d of DEFAULT_BLOCKED_DOMAINS) {
                if (!beforeSet.has(d)) { beforeSet.add(d); changed = true; }
            }
            if (changed) {
                captureState.settings.blockedDomains = Array.from(beforeSet);
                saveSettings();
            }
            pruneBlockedFromCurrentSession();
        }
    });
}

function pruneBlockedFromCurrentSession() {
    try {
        if (!captureState.targetDomain) return;
        const blocked = captureState.settings.blockedDomains || [];
        const session = captureState.sessions[captureState.targetDomain];
        if (!session) return;
        if (Array.isArray(session.urlSet)) session.urlSet = new Set(session.urlSet);
        const before = session.requests.length;
        session.requests = session.requests.filter(r => !blocked.some(b => r.domain && r.domain.includes(b)));
        // rebuild urlSet
        session.urlSet = new Set(session.requests.map(r => r.url));
        session.requestCounter = session.requests.length; // keep counter aligned for now
        captureState.capturedRequests = session.requests;
        captureState.requestCounter = session.requestCounter;
        if (before !== session.requests.length) {
            schedulePersist();
            notifyPopupUpdate();
            debugLog('[Prune] Removed', before - session.requests.length, 'blocked requests');
        }
    } catch(e) {
        console.warn('Prune failed', e);
    }
}

// 保存设置
function saveSettings() {
    chrome.storage.local.set({ 
        captureSettings: captureState.settings 
    });
}

// 监听扩展图标点击事件
chrome.action.onClicked.addListener((tab) => {
    openCaptureWindow();
});

// 打开捕获窗口
async function openCaptureWindow() {
    try {
        // 如果窗口已经存在，则聚焦到该窗口
        if (captureWindow) {
            try {
                await chrome.windows.update(captureWindow.id, { focused: true });
                return;
            } catch (error) {
                // 窗口可能已经被关闭，重新创建
                captureWindow = null;
            }
        }

        // 获取当前活动窗口的位置，用于智能定位新窗口
        const currentWindow = await chrome.windows.getCurrent();
        
        // 计算新窗口位置：在当前窗口右侧，如果空间不足则在左侧
        const screenWidth = 1920; // 默认屏幕宽度，实际会根据显示器调整
        const windowWidth = 850;
        const windowHeight = 650;
        
        let left = currentWindow.left + currentWindow.width + 10;
        if (left + windowWidth > screenWidth) {
            left = Math.max(0, currentWindow.left - windowWidth - 10);
        }
        
        const top = currentWindow.top;

        // 创建新的扩展窗口
        captureWindow = await chrome.windows.create({
            url: 'popup.html',
            type: 'popup',
            width: windowWidth,
            height: windowHeight,
            left: left,
            top: top,
            focused: true
        });

        debugLog('Capture window created successfully');
    } catch (error) {
        console.error('Failed to create capture window:', error);
    }
}

// 关闭窗口
function handleCloseWindow(sendResponse) {
    if (captureWindow) {
        chrome.windows.remove(captureWindow.id).then(() => {
            captureWindow = null;
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
    } else {
        sendResponse({ success: true });
    }
}

// 最小化窗口
function handleMinimizeWindow(sendResponse) {
    if (captureWindow) {
        chrome.windows.update(captureWindow.id, { state: 'minimized' }).then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
    } else {
        sendResponse({ success: false, error: 'No window to minimize' });
    }
}

// 打开独立窗口
function handleOpenWindow(sendResponse) {
    openCaptureWindow().then(() => {
        sendResponse({ success: true });
    }).catch((error) => {
        sendResponse({ success: false, error: error.message });
    });
}

// 监听窗口关闭事件
chrome.windows.onRemoved.addListener((windowId) => {
    if (captureWindow && captureWindow.id === windowId) {
        captureWindow = null;
        // Do NOT auto-stop capturing; persist current state
        schedulePersist();
    }
});

// Ensure listeners active after navigation events (resume logic)
chrome.webNavigation.onCommitted.addListener(details => {
    if (!captureState.isCapturing) return;
    if (!captureState.targetDomain) return;
    try {
        const url = new URL(details.url);
        const domain = url.hostname;
        const mode = captureState.settings.captureMode;
        let domainMatch = false;
        switch(mode) {
            case 'main_domain_only':
                domainMatch = domain === captureState.targetDomain; break;
            case 'include_subdomains':
                domainMatch = domain === captureState.targetDomain || domain.endsWith('.'+captureState.targetDomain); break;
            case 'all_domains':
                domainMatch = true; break;
            case 'whitelist':
                const allowed = captureState.settings.allowedDomains || [captureState.targetDomain];
                domainMatch = allowed.some(d => domain === d || domain.endsWith('.'+d));
                break;
            default:
                domainMatch = domain === captureState.targetDomain;
        }
        if (domainMatch) {
            ensureListenersActive();
        }
    } catch(e) {}
});

function ensureListenersActive() {
    const needBefore = !chrome.webRequest.onBeforeRequest.hasListener(handleWebRequest);
    const needCompleted = !chrome.webRequest.onCompleted.hasListener(handleWebResponse);
    if (!(needBefore || needCompleted)) return;
    if (!captureState.isCapturing) return;
    // rebuild urls filter similar to start (simplified: all_urls; filtering handled in shouldCaptureRequest)
    const urls = ["<all_urls>"];
    if (needBefore) {
        chrome.webRequest.onBeforeRequest.addListener(handleWebRequest, { urls }, ["requestBody"]);
    }
    if (needCompleted) {
        chrome.webRequest.onCompleted.addListener(handleWebResponse, { urls }, ["responseHeaders"]);
    }
    debugLog('[Ensure] webRequest listeners active. before:', needBefore, 'completed:', needCompleted);
}
