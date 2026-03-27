// DevTrace popup application v3.0.5
const DEVTRACE_DEBUG = false;
const debugLog = (...args) => {
    if (DEVTRACE_DEBUG) {
        console.log(...args);
    }
};
const {
    isValidDomain,
    getStatusCategory,
    isDownloadableResource,
    generateFilename,
    sanitizeFilename
} = window.DevTracePopupUtils;
const {
    getStorageValue,
    sendRuntimeMessage,
    setStorageValue,
    showError,
    showSuccess,
    showToast,
    sleep
} = window.DevTracePopupServices;

/**
 * 主应用类
 */
class WebRequestCaptureApp {    constructor() {
        this.currentData = [];
        this.filteredData = [];
        this.isCapturing = false;
        this.downloadStatus = new Map(); // 添加下载状态追踪
        this.currentTargetDomain = null;
        this.persistDownloadStatusTimer = null;
        this.isBatchExporting = false;
        this.excludedResources = new Set(); // 追踪被排除的资源
        this.settings = {
            maxRequests: 100,
            saveDetails: false,
            blockAds: true,
            blockStatic: false,
            defaultView: 'popup',  // 'popup' 或 'window'
            captureMode: 'all_domains', // 新增：捕获模式
            allowedDomains: [] // 新增：白名单域名列表
        };
        this.filters = {
            domain: '',
            status: '',
            type: ''
        };
        
        this.initializeApp();
    }

    /**
     * 初始化应用
     */
    async initializeApp() {
        try {
            debugLog('DevTrace: Initializing application...');
            this.applyRuntimeMetadata();
            await this.loadSettings();
            this.bindEvents();
            this.setupMessageListener();
            this.loadSavedUrl();
            this.updateUI();
            
            // 检查用户偏好，如果设置为窗口模式且当前是popup，则自动打开独立窗口
            if (this.settings.defaultView === 'window' && this.isPopupMode()) {
                debugLog('DevTrace: User prefers window mode, auto-opening standalone window...');
                setTimeout(() => {
                    this.openWindow();
                    // 立即关闭popup
                    setTimeout(() => {
                        window.close();
                    }, 300);
                }, 100);
            }
            
            debugLog('DevTrace: Application initialized successfully');
        } catch (error) {
            console.error('DevTrace: Failed to initialize app:', error);
            this.showError('Failed to initialize application');
        }
    }    /**
     * 从 manifest 同步运行时元信息
     */
    applyRuntimeMetadata() {
        try {
            const manifest = chrome.runtime.getManifest();
            const versionBadge = document.getElementById('versionBadge');
            if (versionBadge) {
                versionBadge.textContent = `v${manifest.version}`;
            }
            document.title = `Web Request Capture Pro v${manifest.version}`;
        } catch (error) {
            console.warn('Failed to apply runtime metadata:', error);
        }
    }

    /**
     * 绑定事件监听器
     */
    bindEvents() {
        // 控制按钮
        document.getElementById('startButton').addEventListener('click', () => this.startCapture());
        document.getElementById('stopButton').addEventListener('click', () => this.stopCapture());
        document.getElementById('openWindowButton').addEventListener('click', () => this.openWindow());
        document.getElementById('helpPageTrigger').addEventListener('click', () => this.openHelpPage());
        document.getElementById('helpPageTrigger').addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.openHelpPage();
            }
        });
        this.setupConfirmDialog();
        
        // 数据操作按钮
        document.getElementById('clearButton').addEventListener('click', () => this.clearData());
        const resetBtn = document.getElementById('resetSessionButton');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetSession());
        }
        document.getElementById('exportButton').addEventListener('click', () => this.exportData());
        document.getElementById('exportResourcesButton').addEventListener('click', () => this.exportResources());
        
        // 筛选控件
        document.getElementById('domainFilter').addEventListener('change', (e) => this.updateFilter('domain', e.target.value));
        document.getElementById('statusFilter').addEventListener('change', (e) => this.updateFilter('status', e.target.value));
        document.getElementById('typeFilter').addEventListener('change', (e) => this.updateFilter('type', e.target.value));
        document.getElementById('clearFilters').addEventListener('click', () => this.clearFilters());
        
        // 资源选择复选框事件监听器
        document.getElementById('selectAllCheckbox').addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('resource-checkbox')) {
                this.toggleResourceSelection(e.target);
            }
        });
        
        // 设置面板
        document.getElementById('settingsButton').addEventListener('click', () => this.toggleSettings());
        document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());
        document.getElementById('cancelSettings').addEventListener('click', () => this.closeSettings());
        
        // 捕获模式变化事件
        document.getElementById('captureModeSelect').addEventListener('change', (e) => {
            this.toggleWhitelistSettings(e.target.value === 'whitelist');
        });
        
        // 黑名单域名管理
        this.setupBlacklistHandlers();
        
        // URL输入框回车事件
        document.getElementById('urlInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.startCapture();
            }
        });

        // 添加窗口拖拽功能
        this.addDragFunctionality();
    }

    setupConfirmDialog() {
        const overlay = document.getElementById('confirmOverlay');
        const cancelButton = document.getElementById('confirmCancelButton');
        const acceptButton = document.getElementById('confirmAcceptButton');

        if (!overlay || !cancelButton || !acceptButton) return;

        cancelButton.addEventListener('click', () => this.resolveConfirmDialog(false));
        acceptButton.addEventListener('click', () => this.resolveConfirmDialog(true));
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                this.resolveConfirmDialog(false);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.confirmResolver) {
                this.resolveConfirmDialog(false);
            }
        });
    }

    async showConfirmDialog({
        title = 'Confirm Action',
        message = 'Are you sure?',
        confirmLabel = 'Confirm',
        danger = false
    } = {}) {
        const overlay = document.getElementById('confirmOverlay');
        const titleNode = document.getElementById('confirmTitle');
        const messageNode = document.getElementById('confirmMessage');
        const acceptButton = document.getElementById('confirmAcceptButton');

        if (!overlay || !titleNode || !messageNode || !acceptButton) {
            return false;
        }

        titleNode.textContent = title;
        messageNode.textContent = message;
        acceptButton.textContent = confirmLabel;
        acceptButton.classList.toggle('btn-warning', danger);
        acceptButton.classList.toggle('btn-primary', !danger);
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');

        return new Promise((resolve) => {
            this.confirmResolver = resolve;
            acceptButton.focus();
        });
    }

    resolveConfirmDialog(result) {
        const overlay = document.getElementById('confirmOverlay');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.setAttribute('aria-hidden', 'true');
        }

        if (this.confirmResolver) {
            const resolve = this.confirmResolver;
            this.confirmResolver = null;
            resolve(result);
        }
    }

    /**
     * 设置黑名单域名处理器
     */
    setupBlacklistHandlers() {
        const addDomainBtn = document.getElementById('addBlockedDomainBtn');
        const domainInput = document.getElementById('blockedDomainInput');
        
        if (addDomainBtn && domainInput) {
            // 添加域名按钮点击事件
            addDomainBtn.addEventListener('click', () => {
                this.addBlockedDomain();
            });
            
            // 输入框回车事件
            domainInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addBlockedDomain();
                }
            });
        }
        
        // 加载并显示当前黑名单
        this.loadBlockedDomains();
    }

    /**
     * 添加黑名单域名
     */
    addBlockedDomain() {
        const input = document.getElementById('blockedDomainInput');
        const domain = input.value.trim();
        
        if (!domain) {
            this.showToast('Please enter a domain name', 'warning');
            return;
        }
        
        // 基本域名格式验证
        if (!isValidDomain(domain)) {
            this.showToast('Please enter a valid domain name (e.g., example.com)', 'error');
            return;
        }
        
        // 发送添加黑名单域名的消息
        chrome.runtime.sendMessage({
            message: 'add_blocked_domain',
            domain: domain
        }, (response) => {
            if (response && response.success) {
                this.showToast(`Domain "${domain}" added to blacklist`, 'success');
                input.value = ''; // 清空输入框
                this.loadBlockedDomains(); // 重新加载显示
            } else {
                const error = response?.error || 'Failed to add domain';
                if (error.includes('already exists')) {
                    this.showToast(`Domain "${domain}" is already in blacklist`, 'warning');
                } else {
                    this.showToast(error, 'error');
                }
            }
        });
    }

    /**
     * 移除黑名单域名
     */
    removeBlockedDomain(domain) {
        chrome.runtime.sendMessage({
            message: 'remove_blocked_domain',
            domain: domain
        }, (response) => {
            if (response && response.success) {
                this.showToast(`Domain "${domain}" removed from blacklist`, 'success');
                this.loadBlockedDomains(); // 重新加载显示
            } else {
                this.showToast(response?.error || 'Failed to remove domain', 'error');
            }
        });
    }

    /**
     * 加载并显示黑名单域名
     */
    loadBlockedDomains() {
        chrome.runtime.sendMessage({ message: 'get_settings' }, (response) => {
            if (response && response.settings && response.settings.blockedDomains) {
                this.displayBlockedDomains(response.settings.blockedDomains);
            }
        });
    }

    /**
     * 显示黑名单域名标签
     */
    displayBlockedDomains(blockedDomains) {
        const container = document.getElementById('blockedDomainsContainer');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!blockedDomains || blockedDomains.length === 0) {
            container.innerHTML = '<div class="no-domains">No blocked domains</div>';
            return;
        }
        
        blockedDomains.forEach(domain => {
            const tag = document.createElement('div');
            tag.className = 'domain-tag';
            tag.innerHTML = `
                <span class="domain-text">${domain}</span>
                <button class="remove-btn" data-domain="${domain}" title="Remove ${domain}">×</button>
            `;
            
            // 添加删除按钮事件
            const removeBtn = tag.querySelector('.remove-btn');
            removeBtn.addEventListener('click', () => {
                this.removeBlockedDomain(domain);
            });
            
            container.appendChild(tag);
        });
    }

    /**
     * 设置消息监听器
     */
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'data_updated') {
                this.handleDataUpdate(message.data);
            }
        });
    }

    /**
     * 加载保存的URL
     */
    loadSavedUrl() {
        chrome.storage.local.get(['lastUrl'], (result) => {
            if (result.lastUrl && result.lastUrl.trim()) {
                try {
                    // 验证保存的URL是否有效
                    const testUrl = result.lastUrl.startsWith('http') ? result.lastUrl : `https://${result.lastUrl}`;
                    new URL(testUrl); // 测试URL是否有效
                    document.getElementById('urlInput').value = result.lastUrl;
                } catch (error) {
                    console.warn('Saved URL is invalid, clearing it:', result.lastUrl);
                    // 清除无效的保存URL
                    chrome.storage.local.remove(['lastUrl']);
                }
            }
        });
    }

    /**
     * 加载设置
     */
    async loadSettings() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ message: 'get_settings' }, (response) => {
                if (response && response.settings) {
                    this.settings = response.settings;
                    this.updateSettingsUI();
                }
                resolve();
            });
        });
    }

    sendRuntimeMessage(message) {
        return sendRuntimeMessage(message);
    }

    getStorageValue(keys) {
        return getStorageValue(keys);
    }

    setStorageValue(values) {
        return setStorageValue(values);
    }

    async setCurrentTargetDomain(domain) {
        if (!domain) {
            this.currentTargetDomain = null;
            this.downloadStatus.clear();
            this.updateExportResourcesButton();
            return;
        }

        if (this.currentTargetDomain === domain) {
            return;
        }

        this.currentTargetDomain = domain;
        await this.loadPersistedDownloadStatus(domain);
    }

    async loadPersistedDownloadStatus(domain) {
        const result = await this.getStorageValue(['downloadStatusByDomain']);
        const allStatuses = result.downloadStatusByDomain || {};
        const domainStatuses = allStatuses[domain] || {};
        this.downloadStatus = new Map(
            Object.entries(domainStatuses).map(([url, status]) => [
                url,
                status === 'downloading' ? 'ready' : status
            ])
        );
        this.syncDownloadStatusWithCurrentData();
        this.updateTable();
        this.updateStats();
    }

    schedulePersistDownloadStatus() {
        if (this.persistDownloadStatusTimer) {
            clearTimeout(this.persistDownloadStatusTimer);
        }

        this.persistDownloadStatusTimer = setTimeout(() => {
            this.persistDownloadStatusTimer = null;
            this.persistDownloadStatus().catch((error) => {
                console.warn('Failed to persist download status:', error);
            });
        }, 150);
    }

    async persistDownloadStatus() {
        if (!this.currentTargetDomain) return;

        const result = await this.getStorageValue(['downloadStatusByDomain']);
        const allStatuses = result.downloadStatusByDomain || {};
        const serializableStatuses = {};

        for (const [url, status] of this.downloadStatus.entries()) {
            if (status && status !== 'ready' && status !== 'downloading') {
                serializableStatuses[url] = status;
            }
        }

        if (Object.keys(serializableStatuses).length > 0) {
            allStatuses[this.currentTargetDomain] = serializableStatuses;
        } else {
            delete allStatuses[this.currentTargetDomain];
        }

        await this.setStorageValue({ downloadStatusByDomain: allStatuses });
    }

    async clearPersistedDownloadStatus(domain = this.currentTargetDomain) {
        if (!domain) return;

        const result = await this.getStorageValue(['downloadStatusByDomain']);
        const allStatuses = result.downloadStatusByDomain || {};

        if (!(domain in allStatuses)) return;

        delete allStatuses[domain];
        await this.setStorageValue({ downloadStatusByDomain: allStatuses });
    }

    /**
     * 开始捕获
     */
    async startCapture() {
        debugLog('DevTrace: startCapture() called');
        
        const url = document.getElementById('urlInput').value.trim();
        debugLog('DevTrace: Input URL:', url);
        
        if (!url) {
            debugLog('DevTrace: Empty URL');
            this.showError('Please enter a valid URL');
            return;
        }

        try {
            // 添加协议前缀（如果缺少）
            const fullUrl = url.startsWith('http') ? url : `https://${url}`;
            debugLog('DevTrace: Full URL:', fullUrl);
            
            const targetDomain = new URL(fullUrl).hostname;
            debugLog('DevTrace: Target domain:', targetDomain);
            
            // 保存URL
            chrome.storage.local.set({ lastUrl: url });

            // 每次重新开始前，自动停止旧监听并清空旧数据
            await this.sendRuntimeMessage({ message: 'stop_capture' });
            await this.sendRuntimeMessage({ message: 'clear_requests' });
            await this.clearPersistedDownloadStatus(targetDomain);
            this.currentData = [];
            this.filteredData = [];
            this.downloadStatus.clear();
            this.currentTargetDomain = targetDomain;
            this.isBatchExporting = false;
            this.isCapturing = false;
            this.updateTable();
            this.updateStats();
            this.updateCaptureState();

            // 发送开始捕获消息
            const response = await this.sendRuntimeMessage({
                message: 'start_capture',
                url: fullUrl
            });
            debugLog('DevTrace: Background response:', response);

            if (response && response.success) {
                this.isCapturing = true;
                await this.setCurrentTargetDomain(response.targetDomain || targetDomain);
                this.updateCaptureState();
                this.openUrlInCurrentTab(fullUrl);
                document.getElementById('targetDomain').textContent = response.targetDomain || targetDomain;

                const captureMode = response.captureMode || 'main_domain_only';
                const modeText = this.getCaptureModeText(captureMode);
                this.showSuccess(`Started capturing requests for ${response.targetDomain || targetDomain} (${modeText})`);
            } else {
                const errorMsg = response?.error || 'Failed to start capture';
                debugLog('DevTrace: Capture failed:', errorMsg);

                if (errorMsg.includes('Permission denied')) {
                    this.showError('Permission denied. Please grant access to analyze this website.');
                } else {
                    this.showError(errorMsg);
                }
            }
        } catch (error) {
            console.error('DevTrace: URL parsing error:', error);
            this.showError('Invalid URL format. Please enter a valid URL (e.g., example.com or https://example.com)');
        }
    }

    /**
     * 停止捕获
     */
    stopCapture() {
        chrome.runtime.sendMessage({ message: 'stop_capture' }, (response) => {
            if (response && response.success) {
                this.isCapturing = false;
                this.updateCaptureState();
                this.showSuccess(`Capture stopped. Total requests: ${response.totalCaptured || 0}`);
            } else {
                this.showError('Failed to stop capture');
            }
        });
    }    /**
     * 在原浏览器窗口打开URL
     */
    openUrlInCurrentTab(url) {
        // 获取所有非扩展窗口
        chrome.windows.getAll({ windowTypes: ['normal'] }, (windows) => {
            if (windows.length > 0) {
                // 找到最近活动的普通浏览器窗口
                const targetWindow = windows.find(w => w.focused) || windows[0];
                
                // 在该窗口的活动标签页中打开URL
                chrome.tabs.query({ active: true, windowId: targetWindow.id }, (tabs) => {
                    if (tabs.length > 0) {
                        chrome.tabs.update(tabs[0].id, { url: url });
                    } else {
                        // 如果没有活动标签页，创建新标签页
                        chrome.tabs.create({ url: url, windowId: targetWindow.id });
                    }
                });
            } else {
                // 如果没有普通浏览器窗口，创建新窗口
                chrome.windows.create({ url: url, type: 'normal' });
            }
        });
    }

    /**
     * 处理数据更新
     */
    async handleDataUpdate(data) {
        this.currentData = data.requests || [];
        if (data.targetDomain) {
            await this.setCurrentTargetDomain(data.targetDomain);
        }
        this.syncDownloadStatusWithCurrentData();
        if (typeof data.isCapturing === 'boolean') this.isCapturing = data.isCapturing;
        if (data.targetDomain) {
            const td = document.getElementById('targetDomain');
            if (td) td.textContent = data.targetDomain;
        }
        this.updateCaptureState();
        this.applyFilters();
        this.updateTable();
        this.updateStats();
    }

    /**
     * 更新筛选器
     */
    updateFilter(filterType, value) {
        this.filters[filterType] = value;
        this.applyFilters();
        this.updateTable();
        this.updateStats();
    }

    /**
     * 应用筛选器
     */
    applyFilters() {
        this.filteredData = this.currentData.filter(request => {
            // 域名筛选
            if (this.filters.domain && request.domain !== this.filters.domain) {
                return false;
            }
            
            // 状态码筛选
            if (this.filters.status) {
                const status = request.status;
                const statusCategory = getStatusCategory(status);
                if (statusCategory !== this.filters.status) {
                    return false;
                }
            }
            
            // 类型筛选
            if (this.filters.type && request.type !== this.filters.type) {
                return false;
            }
            
            return true;
        });

        // 更新筛选器选项
        this.updateFilterOptions();
    }

    /**
     * 更新筛选器选项
     */
    updateFilterOptions() {
        // 更新域名选项
        const domains = [...new Set(this.currentData.map(req => req.domain))];
        const domainSelect = document.getElementById('domainFilter');
        const currentDomain = domainSelect.value;
        
        domainSelect.innerHTML = '<option value="">All Domains</option>';
        domains.forEach(domain => {
            const option = document.createElement('option');
            option.value = domain;
            option.textContent = domain;
            if (domain === currentDomain) option.selected = true;
            domainSelect.appendChild(option);
        });
    }

    syncDownloadStatusWithCurrentData() {
        const validUrls = new Set(this.currentData.map(request => request.url));
        let changed = false;
        for (const url of Array.from(this.downloadStatus.keys())) {
            if (!validUrls.has(url)) {
                this.downloadStatus.delete(url);
                changed = true;
            }
        }
        if (changed) {
            this.schedulePersistDownloadStatus();
        }
    }

    /**
     * 清除筛选器
     */
    clearFilters() {
        // 重置筛选器状态
        this.filters = { domain: '', status: '', type: '' };
        
        // 重置UI控件
        document.getElementById('domainFilter').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('typeFilter').value = '';
        
        // 重新应用筛选（实际上是显示所有数据）
        this.applyFilters();
        this.updateTable();
        this.updateStats();
        
        this.showSuccess('Filters cleared - showing all data');
    }

    /**
     * 更新表格
     */    updateTable() {
        const tableBody = document.getElementById('dataTableBody');
          if (this.filteredData.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="11" class="empty-state">
                        <div class="empty-state-icon">${this.currentData.length === 0 ? '📊' : '🔍'}</div>
                        <div>${this.currentData.length === 0 ? 'No requests captured yet' : 'No requests match current filters'}</div>
                    </td>
                </tr>
            `;
            return;
        }        const rows = this.filteredData.map((request, index) => {
            const time = new Date(request.timestamp).toLocaleTimeString();
            const methodClass = `method-${request.method.toLowerCase()}`;
            const statusClass = `status-${getStatusCategory(request.status)}`;
            const size = this.formatSize(request.size || 0);
            
            // 获取下载状态
            const downloadStatus = this.getDownloadStatus(request.url);
            let downloadStatusHtml = '';
            let actionButtonHtml = '';
            
            if (isDownloadableResource(request)) {
                if (downloadStatus === 'downloading') {
                    downloadStatusHtml = '<span class="download-status downloading">⏳ Downloading</span>';
                    actionButtonHtml = '<button class="save-btn saving" disabled>Saving...</button>';
                } else if (downloadStatus === 'completed') {
                    downloadStatusHtml = '<span class="download-status completed">✅ Downloaded</span>';
                    actionButtonHtml = '<button class="save-btn saved" disabled>Saved</button>';
                } else if (downloadStatus === 'failed') {
                    downloadStatusHtml = '<span class="download-status failed">❌ Failed</span>';
                    actionButtonHtml = `<button class="save-btn" data-url="${encodeURIComponent(request.url)}" data-index="${index}">Save</button>`;
                } else {
                    downloadStatusHtml = '<span class="download-status pending">📥 Ready</span>';
                    actionButtonHtml = `<button class="save-btn" data-url="${encodeURIComponent(request.url)}" data-index="${index}">Save</button>`;
                }
            } else {
                downloadStatusHtml = '<span class="download-status excluded">➖ Excluded</span>';
                actionButtonHtml = '<button class="save-btn" disabled>N/A</button>';
            }
              const isExcluded = this.excludedResources?.has(request.url) || false;
            const checkboxChecked = !isExcluded ? 'checked' : '';
            const rowClass = isExcluded ? 'row-excluded' : '';
            
            return `
                <tr data-index="${index}" class="${rowClass}">
                    <td><input type="checkbox" class="resource-checkbox" data-url="${encodeURIComponent(request.url)}" ${checkboxChecked}></td>
                    <td>${index + 1}</td>
                    <td>${time}</td>
                    <td><span class="method-badge ${methodClass}">${request.method}</span></td>
                    <td>${request.domain}</td>
                    <td class="url-cell" title="${request.url}">${request.url}</td>
                    <td><span class="status-badge ${statusClass}">${request.status || 'Pending'}</span></td>
                    <td>${request.type}</td>
                    <td>${size}</td>
                    <td>${downloadStatusHtml}</td>
                    <td>${actionButtonHtml}</td>
                </tr>
            `;
        }).join('');

        tableBody.innerHTML = rows;
          // 添加保存按钮的事件监听器
        this.addSaveButtonListeners();
        
        // 更新全选复选框状态
        this.updateSelectAllCheckbox();
    }

    /**
     * 添加保存按钮的事件监听器
     */
    addSaveButtonListeners() {
        const saveButtons = document.querySelectorAll('.save-btn[data-url]');
        saveButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const url = decodeURIComponent(e.target.getAttribute('data-url'));
                const index = parseInt(e.target.getAttribute('data-index'));
                this.saveIndividualResource(url, index);
            });
        });
    }/**
     * 格式化文件大小
     */
    formatSize(bytes) {
        if (!bytes || bytes <= 0) return '-';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * 更新统计信息
     */
    updateStats() {
        document.getElementById('captureCount').textContent = this.currentData.length;
        document.getElementById('filteredCount').textContent = this.filteredData.length;
        document.getElementById('totalRequests').textContent = this.currentData.length;
        
        // 计算内存使用
        const memoryKB = Math.round(JSON.stringify(this.currentData).length / 1024);
        document.getElementById('memoryUsage').textContent = `${memoryKB} KB`;
        
        // 更新可导出资源数量
        this.updateExportResourcesButton();
    }    /**
     * 更新导出资源按钮状态
     */
    updateExportResourcesButton() {
        const exportResourcesBtn = document.getElementById('exportResourcesButton');
        if (!exportResourcesBtn) return;

        // 使用选中的可下载资源数量
        const selectedDownloadableCount = this.getSelectedResourcesCount();

        if (selectedDownloadableCount > 0) {
            exportResourcesBtn.textContent = this.isBatchExporting
                ? `Exporting... (${selectedDownloadableCount} pending)`
                : `Export Resources (${selectedDownloadableCount})`;
            exportResourcesBtn.disabled = this.isBatchExporting;
        } else {
            exportResourcesBtn.textContent = this.isBatchExporting
                ? 'Exporting...'
                : 'Export Resources (0)';
            exportResourcesBtn.disabled = true;
        }
    }

    /**
     * 更新捕获状态
     */
    updateCaptureState() {
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        const startButton = document.getElementById('startButton');
        const stopButton = document.getElementById('stopButton');

        const capturing = this.isCapturing;
        const dotClass = capturing ? 'status-dot capturing' : 'status-dot stopped';
        const text = capturing ? 'Capturing...' : 'Stopped';

    if (statusDot) statusDot.className = dotClass;
    if (statusText) statusText.textContent = text;

        if (startButton) startButton.disabled = capturing;
        if (stopButton) stopButton.disabled = !capturing;
    }    /**
     * 清空数据
     */
    async clearData() {
        if (this.currentData.length === 0) {
            this.showError('No data to clear');
            return;
        }

        const confirmed = await this.showConfirmDialog({
            title: 'Clear Captured Data',
            message: `This will permanently remove all ${this.currentData.length} captured requests from the current session.`,
            confirmLabel: 'Clear Data',
            danger: true
        });

        if (!confirmed) return;

        chrome.runtime.sendMessage({ message: 'clear_requests' }, (response) => {
            if (response && response.success) {
                this.currentData = [];
                this.filteredData = [];
                this.downloadStatus.clear();
                this.clearPersistedDownloadStatus().catch(() => {});
                this.isBatchExporting = false;
                this.updateTable();
                this.updateStats();
                this.showSuccess('All captured data cleared successfully');
            } else {
                this.showError('Failed to clear data');
            }
        });
    }

    /**
     * 导出数据
     */    /**
     * 导出数据（简化为URL数组格式）
     */
    exportData() {
        if (this.filteredData.length === 0) {
            this.showError('No data to export');
            return;
        }

        // 使用资源检查功能过滤，只导出选中的可下载资源URL
        const selectedDownloadableUrls = this.filteredData
            .filter(request => isDownloadableResource(request) && !this.excludedResources.has(request.url))
            .map(request => request.url);

        if (selectedDownloadableUrls.length === 0) {
            this.showError('No selected downloadable resources found to export');
            return;
        }

        // 创建简化的JSON数据（仅包含URL数组）
        const dataStr = JSON.stringify(selectedDownloadableUrls, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        // 生成包含完整时间的文件名
        const now = new Date();
        const dateStr = now.getFullYear() + 
                       String(now.getMonth() + 1).padStart(2, '0') + 
                       String(now.getDate()).padStart(2, '0');
        const timeStr = String(now.getHours()).padStart(2, '0') + 
                       String(now.getMinutes()).padStart(2, '0') + 
                       String(now.getSeconds()).padStart(2, '0');
        const filename = `resource_urls_${dateStr}_${timeStr}.json`;
        
        chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                this.showError('Export failed: ' + chrome.runtime.lastError.message);
            } else {
                this.showSuccess(`Exported ${selectedDownloadableUrls.length} selected resource URLs to ${filename}`);
            }
            URL.revokeObjectURL(url);
        });
    }/**
     * 保存单个资源
     */
    async saveIndividualResource(url, index) {
        // 从过滤后的数据中找到对应的资源
        const resource = this.filteredData[index];
        if (!resource || resource.url !== url) {
            this.showToast('Resource not found', 'error');
            return;
        }

        // 检查是否可下载
        if (!isDownloadableResource(resource)) {
            this.showToast('This resource type is not downloadable', 'warning');
            return;
        }        try {
            // 第一步：更新状态为正在下载
            this.updateResourceStatus(index, 'downloading');
            
            // 第二步：打开文件夹选择器
            debugLog('Opening folder picker for resource:', resource.url);
              if (window.showDirectoryPicker) {
                // 先显示说明
                this.showToast('📁 Note: Due to browser security, some files may be saved to Downloads folder with organized structure', 'info');
                
                const directoryHandle = await window.showDirectoryPicker({
                    mode: 'readwrite'
                });
                  debugLog('User selected folder:', directoryHandle.name);
                this.showToast(`Selected folder: ${directoryHandle.name}`, 'success');                // 第三步：保存资源（智能选择方案）
                await this.saveResourceSmart(resource, directoryHandle, index);
            } else {
                this.showToast('Your browser does not support folder picker', 'error');
            }        } catch (error) {
            this.updateResourceStatus(index, 'failed');
            if (error.name === 'AbortError') {
                this.showToast('Folder selection cancelled', 'info');
                this.updateResourceStatus(index, 'ready');
            } else {
                console.error('Save individual resource failed:', error);
                this.showToast('Failed to save resource: ' + error.message, 'error');
            }        }    }

    /**
     * 智能保存资源（尝试直接保存，失败则降级到Downloads）
     */
    async saveResourceSmart(resource, directoryHandle, index) {
        try {
            // 先尝试直接保存到用户选择的目录
            await this.saveResourceToUserDirectory(resource, directoryHandle, index);
        } catch (error) {
            debugLog('Direct save failed, falling back to Downloads API:', error.message);
            // 降级到Downloads API
            this.showToast('⚠️ Using Downloads folder due to browser restrictions...', 'warning');
            await this.saveResourceWithDownloadsAPI(resource, directoryHandle.name, index);
        }
    }

    /**
     * 保存资源到用户选择的目录
     */
    async saveResourceToUserDirectory(resource, directoryHandle, index) {
        try {
            // 解析URL获取域名和路径
            const url = new URL(resource.url);
            const domain = url.hostname;
            const pathname = url.pathname;
            
            debugLog('Saving resource to user directory:');
            debugLog('  Domain:', domain);
            debugLog('  Path:', pathname);
            
            // 分析路径，创建目录结构
            const pathSegments = pathname.split('/').filter(segment => segment !== '');
            debugLog('  Path segments:', pathSegments);
            
            // 创建域名文件夹
            let currentHandle = directoryHandle;
            
            // 第一级：域名文件夹
            try {
                const domainHandle = await currentHandle.getDirectoryHandle(domain, { create: true });
                currentHandle = domainHandle;
                debugLog('  Created/accessed domain folder:', domain);
            } catch (error) {
                console.error('Failed to create domain folder:', error);
                throw new Error(`Failed to create domain folder: ${domain}`);
            }
            
            // 后续级别：路径文件夹（排除最后一个文件名）
            if (pathSegments.length > 1) {
                const directorySegments = pathSegments.slice(0, -1); // 去掉最后的文件名
                
                for (const segment of directorySegments) {
                    if (segment && segment.trim() !== '') {
                        try {
                            const segmentHandle = await currentHandle.getDirectoryHandle(segment, { create: true });
                            currentHandle = segmentHandle;
                            debugLog('  Created/accessed path folder:', segment);
                        } catch (error) {
                            console.error(`Failed to create path folder: ${segment}`, error);
                            // 继续，不中断整个过程
                        }
                    }
                }
            }            // 获取资源数据
            debugLog('  Fetching resource data...');
            
            // 尝试直接fetch
            let blob;
            const response = await fetch(resource.url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            blob = await response.blob();
              // 生成文件名
            const filename = generateFilename(resource, index + 1);
            debugLog('  Generated filename:', filename);
            
            // 获取文件数据
            debugLog('  Getting file data...');
            
            // 创建文件并写入数据
            const fileHandle = await currentHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            
            await writable.write(blob);
            await writable.close();
            
            // 更新状态为已下载
            this.updateResourceStatus(index, 'completed');
            
            // 显示成功信息
            const directoryPath = [domain, ...pathSegments.slice(0, -1)].filter(p => p).join('/');
            this.showToast(`✅ File saved: ${directoryPath}/${filename}`, 'success');
              } catch (error) {
            console.error('Failed to save resource to user directory:', error);
            this.updateResourceStatus(index, 'failed');
            // 重新抛出错误，让上级方法处理降级
            throw error;
        }
    }    /**
     * 使用Chrome Downloads API保存单个资源（降级方案）
     */
    async saveResourceWithDownloadsAPI(resource, folderName, index) {
        try {
            // 解析URL获取域名和路径
            const url = new URL(resource.url);
            const domain = url.hostname;
            const pathname = url.pathname;
            
            // 生成目录路径
            const pathSegments = pathname.split('/').filter(segment => segment !== '');
            const directorySegments = pathSegments.slice(0, -1); // 去掉文件名部分
            
            let directoryPath = domain;
            if (directorySegments.length > 0) {
                directoryPath += '/' + directorySegments.join('/');
            }
            
            // 生成文件名
            const filename = generateFilename(resource, index + 1);
            
            // 生成完整的下载路径（直接使用用户选择的文件夹名，不添加时间戳）
            const fullPath = `${folderName}/${directoryPath}/${filename}`;
            
            debugLog('Downloading resource to:', fullPath);
            
            // 使用Chrome Downloads API下载
            await new Promise((resolve, reject) => {
                chrome.downloads.download({
                    url: resource.url,
                    filename: fullPath,
                    saveAs: false
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        console.error('Download failed:', chrome.runtime.lastError.message);
                        this.updateResourceStatus(index, 'failed');
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        debugLog('Download started:', filename);
                        
                        // 监听下载完成
                        const onDownloadChanged = (downloadDelta) => {
                            if (downloadDelta.id === downloadId && downloadDelta.state) {
                                if (downloadDelta.state.current === 'complete') {
                                    chrome.downloads.onChanged.removeListener(onDownloadChanged);
                                    this.updateResourceStatus(index, 'completed');
                                    debugLog('Download completed:', filename);
                                    resolve(downloadId);
                                } else if (downloadDelta.state.current === 'interrupted') {
                                    chrome.downloads.onChanged.removeListener(onDownloadChanged);
                                    this.updateResourceStatus(index, 'failed');
                                    reject(new Error('Download was interrupted'));
                                }
                            }
                        };
                        
                        chrome.downloads.onChanged.addListener(onDownloadChanged);
                        
                        // 设置超时
                        setTimeout(() => {
                            chrome.downloads.onChanged.removeListener(onDownloadChanged);
                            this.updateResourceStatus(index, 'failed');
                            reject(new Error('Download timeout'));
                        }, 30000); // 30秒超时
                    }
                });
            });
            
            // 显示成功信息
            this.showToast(`✅ File saved: Downloads/${fullPath}`, 'success');
            
        } catch (error) {
            console.error('Failed to save resource:', error);
            this.updateResourceStatus(index, 'failed');
            this.showToast('❌ Failed to save file: ' + error.message, 'error');
        }
    }

    /**
     * 更新资源状态
     */
    updateResourceStatus(index, status) {
        const resource = this.filteredData[index];
        if (resource?.url) {
            this.setDownloadStatus(resource.url, status);
        }

        const statusCell = document.querySelector(`tr[data-index="${index}"] .download-status`);
        if (statusCell) {
            statusCell.textContent = this.getStatusText(status);
            statusCell.className = `download-status ${status}`;
        }

        const actionCell = document.querySelector(`tr[data-index="${index}"] td:last-child`);
        if (actionCell && resource && isDownloadableResource(resource)) {
            if (status === 'downloading') {
                actionCell.innerHTML = '<button class="save-btn saving" disabled>Saving...</button>';
            } else if (status === 'completed') {
                actionCell.innerHTML = '<button class="save-btn saved" disabled>Saved</button>';
            } else if (status === 'failed' || status === 'ready') {
                actionCell.innerHTML = `<button class="save-btn" data-url="${encodeURIComponent(resource.url)}" data-index="${index}">Save</button>`;
                this.addSaveButtonListeners();
            }
        }

        this.updateExportResourcesButton();
    }

    getDownloadStatus(url) {
        const rawStatus = this.downloadStatus.get(url);
        if (rawStatus === 'downloaded') return 'completed';
        return rawStatus || 'ready';
    }

    setDownloadStatus(url, status) {
        const normalizedStatus = status === 'downloaded' ? 'completed' : status;
        this.downloadStatus.set(url, normalizedStatus);
        this.schedulePersistDownloadStatus();
    }

    /**
     * 获取状态文本
     */
    getStatusText(status) {
        const statusTexts = {
            'ready': 'Ready',
            'downloading': 'Downloading...',
            'completed': 'Downloaded',
            'downloaded': 'Downloaded',
            'failed': 'Failed',
            'excluded': 'N/A'
        };
        return statusTexts[status] || status;
    }

    /**
     * 导出资源文件 - 先选择目录，再批量写入该目录
     */
    async exportResources() {
        if (this.isBatchExporting) {
            this.showToast('Batch export is already running', 'info');
            return;
        }

        const resources = this.getPendingBatchResources();

        if (resources.length === 0) {
            this.showToast('No selected downloadable resources found', 'warning');
            return;
        }

        if (!window.showDirectoryPicker) {
            this.showToast('Your browser does not support folder selection for batch export', 'error');
            return;
        }

        let directoryHandle;
        try {
            directoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite',
                startIn: 'downloads'
            });
        } catch (error) {
            if (error.name === 'AbortError') {
                this.showToast('Folder selection cancelled', 'info');
                return;
            }

            console.error('Failed to open folder picker:', error);
            this.showToast('Failed to open folder picker: ' + error.message, 'error');
            return;
        }

        this.isBatchExporting = true;
        this.showToast(`🚀 Starting batch export to ${directoryHandle.name}/`, 'info');

        let downloaded = 0;
        let failed = 0;
        let fileNumber = 1;
        let idleRounds = 0;
        const exportedResources = [];

        try {
            while (idleRounds < 3) {
                const pendingResources = this.getPendingBatchResources();

                if (pendingResources.length === 0) {
                    idleRounds++;
                    await this.sleep(800);
                    continue;
                }

                idleRounds = 0;

                for (const resource of pendingResources) {
                    const currentStatus = this.getDownloadStatus(resource.url);
                    if (currentStatus === 'completed' || currentStatus === 'downloading') {
                        continue;
                    }

                    const originalIndex = this.filteredData.findIndex(r => r.url === resource.url);
                    this.setDownloadStatus(resource.url, 'downloading');
                    if (originalIndex !== -1) {
                        this.updateResourceStatus(originalIndex, 'downloading');
                    }

                    try {
                        await this.saveResourceToSelectedDirectory(resource, directoryHandle, originalIndex, fileNumber);
                        downloaded++;
                        exportedResources.push(resource);
                        this.updateExportResourcesButton();
                    } catch (error) {
                        console.error('Failed to export resource:', resource.url, error);
                        failed++;

                        if (originalIndex !== -1) {
                            this.updateResourceStatus(originalIndex, 'failed');
                        } else {
                            this.setDownloadStatus(resource.url, 'failed');
                        }
                    }

                    fileNumber++;
                    await this.sleep(50);
                }
            }

            await this.createBatchExportIndexFileInDirectory(directoryHandle, exportedResources);
        } finally {
            this.isBatchExporting = false;
            this.updateExportResourcesButton();
        }

        if (downloaded > 0) {
            this.showToast(`✅ Batch export completed! ${downloaded} files saved to ${directoryHandle.name}/`, 'success');
        }
        if (failed > 0) {
            this.showToast(`⚠️ ${failed} files failed to export`, 'warning');
        }
    }

    /**
     * 批量保存资源到用户选择的目录
     */
    async saveResourceToSelectedDirectory(resource, directoryHandle, index, fileNumber) {
        try {
            const url = new URL(resource.url);
            const domainName = sanitizeFilename(url.hostname || 'unknown-domain') || 'unknown-domain';
            const pathSegments = url.pathname
                .split('/')
                .filter(segment => segment !== '')
                .slice(0, -1)
                .map(segment => sanitizeFilename(segment))
                .filter(Boolean);

            let currentHandle = await directoryHandle.getDirectoryHandle(domainName, { create: true });
            for (const segment of pathSegments) {
                currentHandle = await currentHandle.getDirectoryHandle(segment, { create: true });
            }

            const response = await fetch(resource.url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const blob = await response.blob();
            const filename = generateFilename(resource, fileNumber);
            const fileHandle = await currentHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            if (index !== -1) {
                this.updateResourceStatus(index, 'completed');
            } else {
                this.setDownloadStatus(resource.url, 'completed');
            }
        } catch (error) {
            console.warn('Direct directory export failed, falling back to Downloads API:', resource.url, error);
            await this.saveResourceWithChromeDownloads(resource, directoryHandle.name, index, fileNumber);
        }
    }

    /**
     * 在用户选择的目录中创建批量导出索引文件
     */
    async createBatchExportIndexFileInDirectory(directoryHandle, resources) {
        try {
            const now = new Date();
            const exportDate = now.toLocaleString();
            const timestamp = now.getFullYear() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0') + '_' +
                String(now.getHours()).padStart(2, '0') +
                String(now.getMinutes()).padStart(2, '0') +
                String(now.getSeconds()).padStart(2, '0');

            let indexContent = `Web Request Capture Pro - Batch Export\n`;
            indexContent += `Export Date: ${exportDate}\n`;
            indexContent += `Total Resources: ${resources.length}\n`;
            indexContent += `\n========================================\n\n`;

            resources.forEach((resource, index) => {
                const url = new URL(resource.url);
                const domain = url.hostname;
                const path = url.pathname;
                const filename = generateFilename(resource, index + 1);

                const pathSegments = path.split('/').filter(segment => segment !== '');
                const directorySegments = pathSegments.slice(0, -1);
                let directoryPath = domain;
                if (directorySegments.length > 0) {
                    directoryPath += '/' + directorySegments.join('/');
                }

                indexContent += `${index + 1}. ${filename}\n`;
                indexContent += `   URL: ${resource.url}\n`;
                indexContent += `   Directory: ${directoryPath}\n`;
                indexContent += `   Type: ${resource.type || 'unknown'}\n`;
                indexContent += `   Method: ${resource.method || 'GET'}\n`;
                indexContent += `\n`;
            });

            const indexHandle = await directoryHandle.getFileHandle(`export_index_${timestamp}.txt`, { create: true });
            const writable = await indexHandle.createWritable();
            await writable.write(indexContent);
            await writable.close();
        } catch (error) {
            console.error('Failed to create batch export index file in selected directory:', error);
        }
    }

    /**
     * 延迟函数
     */
    sleep(ms) {
        return sleep(ms);
    }

    /**
     * 切换设置面板
     */
    toggleSettings() {
        const panel = document.getElementById('settingsPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        if (panel.style.display === 'block') {
            this.updateSettingsUI();
        }
    }

    /**
     * 更新设置UI
     */
    updateSettingsUI() {
        document.getElementById('maxRequestsSetting').value = this.settings.maxRequests;
        document.getElementById('saveDetailsSetting').checked = this.settings.saveDetails;
        document.getElementById('blockAdsSetting').checked = this.settings.blockAds;
        document.getElementById('blockStaticSetting').checked = this.settings.blockStatic;
        document.getElementById('defaultViewSetting').value = this.settings.defaultView || 'popup';
        document.getElementById('captureModeSelect').value = this.settings.captureMode || 'all_domains';
        
        // 设置白名单域名
        if (this.settings.allowedDomains) {
            document.getElementById('allowedDomainsInput').value = this.settings.allowedDomains.join('\n');
        }
        
        // 显示/隐藏白名单设置
        this.toggleWhitelistSettings(this.settings.captureMode === 'whitelist');
        
        // 加载并显示黑名单域名
        this.loadBlockedDomains();
    }

    /**
     * 保存设置
     */
    saveSettings() {
        const newSettings = {
            maxRequests: parseInt(document.getElementById('maxRequestsSetting').value),
            saveDetails: document.getElementById('saveDetailsSetting').checked,
            blockAds: document.getElementById('blockAdsSetting').checked,
            blockStatic: document.getElementById('blockStaticSetting').checked,
            defaultView: document.getElementById('defaultViewSetting').value,
            captureMode: document.getElementById('captureModeSelect').value,
            allowedDomains: document.getElementById('allowedDomainsInput').value
                .split('\n')
                .map(domain => domain.trim())
                .filter(domain => domain.length > 0)
        };

        chrome.runtime.sendMessage({ 
            message: 'update_settings', 
            settings: newSettings 
        }, (response) => {
            if (response && response.success) {
                this.settings = newSettings;
                this.closeSettings();
                this.showSuccess('Settings saved successfully');
            } else {
                this.showError('Failed to save settings');
            }
        });
    }

    /**
     * 关闭设置面板
     */
    closeSettings() {
        document.getElementById('settingsPanel').style.display = 'none';
    }

    /**
     * 切换白名单设置显示
     */
    toggleWhitelistSettings(show) {
        const container = document.getElementById('whitelistContainer');
        if (container) {
            container.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * 获取捕获模式的显示文本
     */
    getCaptureModeText(captureMode) {
        const modeTexts = {
            'main_domain_only': 'Main Domain Only',
            'include_subdomains': 'Include Subdomains',
            'all_domains': 'All Domains + iframes',
            'whitelist': 'Whitelist Mode'
        };
        return modeTexts[captureMode] || 'Unknown Mode';
    }

    /**
     * 更新UI状态
     */
    updateUI() {
        this.updateCaptureState();
        this.updateStats();
        
        // 获取当前数据
        chrome.runtime.sendMessage({ message: 'get_captured_data' }, async (response) => {
            if (response) {
                this.currentData = response.requests || [];
                await this.setCurrentTargetDomain(response.targetDomain || null);
                this.syncDownloadStatusWithCurrentData();
                this.isCapturing = !!response.isCapturing;
                if (response.targetDomain) {
                    const td = document.getElementById('targetDomain');
                    if (td) td.textContent = response.targetDomain;
                }
                this.applyFilters();
                this.updateTable();
                this.updateStats();
                this.updateCaptureState();
            }
        });
    }    /**
     * 重置当前会话
     */
    async resetSession() {
        const confirmed = await this.showConfirmDialog({
            title: 'Reset Current Session',
            message: 'This will clear captured requests for the active domain and keep the extension ready for a fresh capture cycle.',
            confirmLabel: 'Reset Session',
            danger: true
        });

        if (!confirmed) return;

        chrome.runtime.sendMessage({ message: 'reset_session' }, (response) => {
            if (response && response.success) {
                this.currentData = [];
                this.filteredData = [];
                this.downloadStatus.clear();
                this.clearPersistedDownloadStatus().catch(() => {});
                this.isBatchExporting = false;
                this.updateTable();
                this.updateStats();
                this.showSuccess('Session reset');
            } else {
                this.showError('Failed to reset session');
            }
        });
    }
    /**
     * 显示错误消息
     */
    showError(message) {
        showError(message);
    }/**
     * 显示成功消息
     */
    showSuccess(message) {
        showSuccess(message);
    }

    /**
     * 显示提示消息
     */
    showToast(message, type = 'info') {
        showToast(message, type);
    }

    /**
     * 打开独立窗口
     */
    openWindow() {
        debugLog('DevTrace: Opening standalone window...');
        chrome.runtime.sendMessage({ message: 'open_window' }, (response) => {
            if (response && response.success) {
                debugLog('DevTrace: Standalone window opened successfully');
                // 如果是popup模式且用户手动点击，也关闭popup
                if (this.isPopupMode()) {
                    setTimeout(() => {
                        window.close();
                    }, 300);
                }
            } else {
                console.error('DevTrace: Failed to open standalone window:', response?.error);
                this.showError('Failed to open standalone window');
            }
        });
    }

    /**
     * 检测是否为popup模式
     */
    isPopupMode() {
        // 检查窗口尺寸，popup通常有固定的小尺寸
        return window.outerWidth <= 850 && window.outerHeight <= 650;
    }

    /**
     * 使用Chrome Downloads API保存资源（批量保存专用）
     */
    async saveResourceWithChromeDownloads(resource, batchFolderName, index, fileNumber) {
        try {
            this.setDownloadStatus(resource.url, 'downloading');
            // 解析URL获取域名和路径
            const url = new URL(resource.url);
            const domain = url.hostname;
            const pathname = url.pathname;
            
            // 生成目录路径
            const pathSegments = pathname.split('/').filter(segment => segment !== '');
            const directorySegments = pathSegments.slice(0, -1); // 去掉文件名部分
            
            let directoryPath = domain;
            if (directorySegments.length > 0) {
                directoryPath += '/' + directorySegments.join('/');
            }
            
            // 生成文件名
            const filename = generateFilename(resource, fileNumber);
            
            // 生成完整的下载路径（使用统一的批量文件夹名）
            const fullPath = `${batchFolderName}/${directoryPath}/${filename}`;
            
            debugLog('Batch downloading resource to:', fullPath);
            
            // 使用Chrome Downloads API下载
            await new Promise((resolve, reject) => {
                chrome.downloads.download({
                    url: resource.url,
                    filename: fullPath,
                    saveAs: false
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        console.error('Batch download failed:', chrome.runtime.lastError.message);
                        if (index !== -1) {
                            this.updateResourceStatus(index, 'failed');
                        } else {
                            this.setDownloadStatus(resource.url, 'failed');
                        }
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        debugLog('Batch download started:', filename);
                        
                        // 监听下载完成
                        const onDownloadChanged = (downloadDelta) => {
                            if (downloadDelta.id === downloadId && downloadDelta.state) {
                                if (downloadDelta.state.current === 'complete') {
                                    chrome.downloads.onChanged.removeListener(onDownloadChanged);
                                    if (index !== -1) {
                                        this.updateResourceStatus(index, 'completed');
                                    } else {
                                        this.setDownloadStatus(resource.url, 'completed');
                                    }
                                    debugLog('Batch download completed:', filename);
                                    resolve(downloadId);
                                } else if (downloadDelta.state.current === 'interrupted') {
                                    chrome.downloads.onChanged.removeListener(onDownloadChanged);
                                    if (index !== -1) {
                                        this.updateResourceStatus(index, 'failed');
                                    } else {
                                        this.setDownloadStatus(resource.url, 'failed');
                                    }
                                    reject(new Error('Download was interrupted'));
                                }
                            }
                        };
                        
                        chrome.downloads.onChanged.addListener(onDownloadChanged);
                        
                        // 设置超时
                        setTimeout(() => {
                            chrome.downloads.onChanged.removeListener(onDownloadChanged);
                            if (index !== -1) {
                                this.updateResourceStatus(index, 'failed');
                            } else {
                                this.setDownloadStatus(resource.url, 'failed');
                            }
                            reject(new Error('Download timeout'));
                        }, 30000); // 30秒超时
                    }
                });
            });
            
            // 显示成功信息（只对前几个文件显示，避免信息过多）
            if (fileNumber <= 3) {
                this.showToast(`✅ File ${fileNumber} saved: ${filename}`, 'success');
            }
            
        } catch (error) {
            console.error('Failed to save resource with Chrome Downloads:', error);
            if (index !== -1) {
                this.updateResourceStatus(index, 'failed');
            } else {
                this.setDownloadStatus(resource.url, 'failed');
            }
            throw error;
        }
    }

    /**
     * 添加窗口拖拽功能
     */
    addDragFunctionality() {
        const header = document.querySelector('.header');
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        header.style.cursor = 'move';
        header.style.userSelect = 'none';

        header.addEventListener('mousedown', (e) => {
            // 只在点击标题区域时启用拖拽
            if (e.target.closest('.url-section') || e.target.closest('.window-controls')) {
                return;
            }
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            // 获取当前窗口位置
            chrome.windows.getCurrent((window) => {
                startLeft = window.left;
                startTop = window.top;
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            chrome.windows.getCurrent((window) => {
                chrome.windows.update(window.id, {
                    left: startLeft + deltaX,
                    top: startTop + deltaY
                });
            });
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });    }

    /**
     * 切换全选/取消全选
     */
    toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.resource-checkbox');
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        
        checkboxes.forEach(checkbox => {
            const url = decodeURIComponent(checkbox.getAttribute('data-url'));
            if (checked) {
                this.excludedResources.delete(url);
                checkbox.checked = true;
            } else {
                this.excludedResources.add(url);
                checkbox.checked = false;
            }
        });
        
        this.updateTable();
        this.updateExportResourcesButton();
        
        // 显示操作提示
        const selectedCount = this.getSelectedResourcesCount();
        this.showToast(`${checked ? 'Selected' : 'Deselected'} all resources (${selectedCount} items)`, 'info');
    }

    /**
     * 切换单个资源的选择状态
     */
    toggleResourceSelection(checkbox) {
        const url = decodeURIComponent(checkbox.getAttribute('data-url'));
        const row = checkbox.closest('tr');
        
        if (checkbox.checked) {
            this.excludedResources.delete(url);
            row.classList.remove('row-excluded');
        } else {
            this.excludedResources.add(url);
            row.classList.add('row-excluded');
        }
        
        // 更新全选复选框状态
        this.updateSelectAllCheckbox();
        this.updateExportResourcesButton();
    }

    /**
     * 更新全选复选框的状态
     */
    updateSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const checkboxes = document.querySelectorAll('.resource-checkbox');
        const checkedCount = document.querySelectorAll('.resource-checkbox:checked').length;
        
        if (checkedCount === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        } else if (checkedCount === checkboxes.length) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        }
    }

    /**
     * 获取选中的资源数量
     */
    getSelectedResourcesCount() {
        return this.getPendingBatchResources().length;
    }

    /**
     * 获取选中的可下载资源
     */
    getSelectedDownloadableResources() {
        return this.filteredData.filter(request => 
            isDownloadableResource(request) && !this.excludedResources.has(request.url)
        );
    }

    getPendingBatchResources() {
        return this.filteredData.filter(request => {
            if (!isDownloadableResource(request) || this.excludedResources.has(request.url)) {
                return false;
            }

            const status = this.getDownloadStatus(request.url);
            return status !== 'completed' && status !== 'downloading';
        });
    }

    openHelpPage() {
        chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
    }
}

// 当DOM加载完成时初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new WebRequestCaptureApp();
});
