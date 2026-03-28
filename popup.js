// DevTrace popup application v1.0.0
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
 * Main application class
 */
class WebRequestCaptureApp {    constructor() {
        this.viewMode = this.resolveViewMode();
        this.currentData = [];
        this.filteredData = [];
        this.isCapturing = false;
        this.downloadStatus = new Map(); // Track per-resource download status
        this.currentTargetDomain = null;
        this.persistDownloadStatusTimer = null;
        this.isBatchExporting = false;
        this.excludedResources = new Set(); // Track excluded resources
        this.settings = {
            maxRequests: 100,
            saveDetails: false,
            blockAds: true,
            blockStatic: false,
            defaultView: 'popup',  // 'popup' or 'window'
            captureMode: 'all_domains', // Active capture mode
            allowedDomains: [] // Whitelisted domain list
        };
        this.filters = {
            domain: '',
            status: '',
            type: ''
        };
        
        this.initializeApp();
    }

    /**
     * Initialize the application
     */
    async initializeApp() {
        try {
            debugLog('DevTrace: Initializing application...');
            this.applyViewMode();
            this.applyRuntimeMetadata();
            await this.loadSettings();
            this.bindEvents();
            this.setupMessageListener();
            this.loadSavedUrl();
            this.updateUI();
            
            // Auto-open the standalone window when the user prefers window mode
            if (this.settings.defaultView === 'window' && this.isPopupMode()) {
                debugLog('DevTrace: User prefers window mode, auto-opening standalone window...');
                setTimeout(() => {
                    this.openWindow();
                    // Close the popup immediately afterward
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
     * Apply runtime metadata from the manifest
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
     * Bind event listeners
     */
    bindEvents() {
        // Primary controls
        document.getElementById('startButton').addEventListener('click', () => this.startCapture());
        document.getElementById('stopButton').addEventListener('click', () => this.stopCapture());
        document.getElementById('openWindowButton').addEventListener('click', () => {
            if (this.isWindowMode()) {
                this.closeWindow();
                return;
            }
            this.openWindow();
        });
        document.getElementById('helpPageTrigger').addEventListener('click', (event) => {
            event.preventDefault();
            this.openHelpPage();
        });
        document.getElementById('helpPageTrigger').addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.openHelpPage();
            }
        });
        this.setupConfirmDialog();
        
        // Data action buttons
        document.getElementById('clearButton').addEventListener('click', () => this.clearData());
        const resetBtn = document.getElementById('resetSessionButton');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetSession());
        }
        document.getElementById('exportButton').addEventListener('click', () => this.exportData());
        document.getElementById('exportResourcesButton').addEventListener('click', () => this.exportResources());
        
        // Filter controls
        document.getElementById('domainFilter').addEventListener('change', (e) => this.updateFilter('domain', e.target.value));
        document.getElementById('statusFilter').addEventListener('change', (e) => this.updateFilter('status', e.target.value));
        document.getElementById('typeFilter').addEventListener('change', (e) => this.updateFilter('type', e.target.value));
        document.getElementById('clearFilters').addEventListener('click', () => this.clearFilters());
        
        // Resource selection checkboxes
        document.getElementById('selectAllCheckbox').addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('resource-checkbox')) {
                this.toggleResourceSelection(e.target);
            }
        });
        
        // Settings panel
        document.getElementById('settingsButton').addEventListener('click', () => this.toggleSettings());
        document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());
        document.getElementById('cancelSettings').addEventListener('click', () => this.closeSettings());
        
        // Capture mode changes
        document.getElementById('captureModeSelect').addEventListener('change', (e) => {
            this.toggleWhitelistSettings(e.target.value === 'whitelist');
        });
        
        // Blocked-domain management
        this.setupBlacklistHandlers();
        
        // Start capture on Enter in the URL field
        document.getElementById('urlInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.startCapture();
            }
        });

        // Enable standalone-window dragging
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

    resolveViewMode() {
        const params = new URLSearchParams(window.location.search);
        return params.get('view') === 'window' ? 'window' : 'popup';
    }

    getSeedUrlFromLocation() {
        const params = new URLSearchParams(window.location.search);
        return params.get('url') || '';
    }

    isWindowMode() {
        return this.viewMode === 'window';
    }

    applyViewMode() {
        const body = document.body;
        const openWindowButton = document.getElementById('openWindowButton');
        if (!body || !openWindowButton) return;

        body.classList.toggle('window-mode', this.isWindowMode());

        if (this.isWindowMode()) {
            openWindowButton.innerHTML = '<span class="close-window-icon">×</span>';
            openWindowButton.title = 'Close floating window';
            openWindowButton.setAttribute('aria-label', 'Close floating window');
        } else {
            openWindowButton.innerHTML = '<span class="window-icon"></span>';
            openWindowButton.title = 'Open in separate window';
            openWindowButton.setAttribute('aria-label', 'Open in separate window');
        }
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
     * Set up blocked-domain handlers
     */
    setupBlacklistHandlers() {
        const addDomainBtn = document.getElementById('addBlockedDomainBtn');
        const domainInput = document.getElementById('blockedDomainInput');
        
        if (addDomainBtn && domainInput) {
            // Add a blocked domain on button click
            addDomainBtn.addEventListener('click', () => {
                this.addBlockedDomain();
            });
            
            // Add a blocked domain on Enter
            domainInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addBlockedDomain();
                }
            });
        }
        
        // Load and display the blocked list
        this.loadBlockedDomains();
    }

    /**
     * Add a blocked domain
     */
    addBlockedDomain() {
        const input = document.getElementById('blockedDomainInput');
        const domain = input.value.trim();
        
        if (!domain) {
            this.showToast('Please enter a domain name', 'warning');
            return;
        }
        
        // Basic domain validation
        if (!isValidDomain(domain)) {
            this.showToast('Please enter a valid domain name (e.g., example.com)', 'error');
            return;
        }
        
        // Send the add-blocked-domain request
        chrome.runtime.sendMessage({
            message: 'add_blocked_domain',
            domain: domain
        }, (response) => {
            if (response && response.success) {
                this.showToast(`Domain "${domain}" added to blacklist`, 'success');
                input.value = ''; // Clear the input field
                this.loadBlockedDomains(); // Refresh the rendered list
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
     * Remove a blocked domain
     */
    removeBlockedDomain(domain) {
        chrome.runtime.sendMessage({
            message: 'remove_blocked_domain',
            domain: domain
        }, (response) => {
            if (response && response.success) {
                this.showToast(`Domain "${domain}" removed from blacklist`, 'success');
                this.loadBlockedDomains(); // Refresh the rendered list
            } else {
                this.showToast(response?.error || 'Failed to remove domain', 'error');
            }
        });
    }

    /**
     * Load and display blocked domains
     */
    loadBlockedDomains() {
        chrome.runtime.sendMessage({ message: 'get_settings' }, (response) => {
            if (response && response.settings && response.settings.blockedDomains) {
                this.displayBlockedDomains(response.settings.blockedDomains);
            }
        });
    }

    /**
     * Render blocked-domain tags
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
            
            // Attach the remove button handler
            const removeBtn = tag.querySelector('.remove-btn');
            removeBtn.addEventListener('click', () => {
                this.removeBlockedDomain(domain);
            });
            
            container.appendChild(tag);
        });
    }

    /**
     * Set up runtime message listeners
     */
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'data_updated') {
                this.handleDataUpdate(message.data);
            }
        });
    }

    /**
     * Load the saved URL
     */
    async loadSavedUrl() {
        const urlInput = document.getElementById('urlInput');
        if (!urlInput) return;

        const seededUrl = this.getSeedUrlFromLocation();
        if (seededUrl) {
            urlInput.value = seededUrl;
            return;
        }

        const [storageResult, captureResult] = await Promise.all([
            this.getStorageValue(['lastUrl']),
            this.sendRuntimeMessage({ message: 'get_captured_data' }).catch(() => null)
        ]);

        const fallbackUrl = this.resolvePreferredUrl(storageResult?.lastUrl, captureResult?.targetDomain);

        if (this.isWindowMode()) {
            if (fallbackUrl) {
                urlInput.value = fallbackUrl;
            }
            return;
        }

        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            const activeTabUrl = tabs?.[0]?.url;
            if (this.isInspectableUrl(activeTabUrl)) {
                urlInput.value = activeTabUrl;
                return;
            }

            if (fallbackUrl) {
                urlInput.value = fallbackUrl;
            }
        });
    }

    resolvePreferredUrl(lastUrl, targetDomain) {
        if (lastUrl && lastUrl.trim()) {
            try {
                const testUrl = lastUrl.startsWith('http') ? lastUrl : `https://${lastUrl}`;
                new URL(testUrl);
                return lastUrl;
            } catch (error) {
                console.warn('Saved URL is invalid, clearing it:', lastUrl);
                chrome.storage.local.remove(['lastUrl']);
            }
        }

        if (targetDomain && typeof targetDomain === 'string') {
            return `https://${targetDomain}`;
        }

        return '';
    }

    isInspectableUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return /^https?:\/\//i.test(url);
    }

    /**
     * Load settings
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

    resetVisibleCaptureContext() {
        this.currentTargetDomain = null;
        const urlInput = document.getElementById('urlInput');
        const targetDomain = document.getElementById('targetDomain');
        if (urlInput) urlInput.value = '';
        if (targetDomain) targetDomain.textContent = '-';
    }

    /**
     * Start capture
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
            // Add a protocol when one is missing
            const fullUrl = url.startsWith('http') ? url : `https://${url}`;
            debugLog('DevTrace: Full URL:', fullUrl);
            
            const targetDomain = new URL(fullUrl).hostname;
            debugLog('DevTrace: Target domain:', targetDomain);
            
            // Persist the entered URL
            chrome.storage.local.set({ lastUrl: url });

            // Stop old listeners and clear stale data before restarting
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

            // Send the start-capture request
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
     * Stop capture
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
     * Open the URL in the original browser window
     */
    openUrlInCurrentTab(url) {
        // Find all regular browser windows
        chrome.windows.getAll({ windowTypes: ['normal'] }, (windows) => {
            if (windows.length > 0) {
                // Pick the most recently focused browser window
                const targetWindow = windows.find(w => w.focused) || windows[0];
                
                // Reuse the active tab in that window
                chrome.tabs.query({ active: true, windowId: targetWindow.id }, (tabs) => {
                    if (tabs.length > 0) {
                        chrome.tabs.update(tabs[0].id, { url: url });
                    } else {
                        // Create a new tab when no active tab exists
                        chrome.tabs.create({ url: url, windowId: targetWindow.id });
                    }
                });
            } else {
                // Create a new browser window when none exist
                chrome.windows.create({ url: url, type: 'normal' });
            }
        });
    }

    /**
     * Handle data updates
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
     * Update a filter
     */
    updateFilter(filterType, value) {
        this.filters[filterType] = value;
        this.applyFilters();
        this.updateTable();
        this.updateStats();
    }

    /**
     * Apply filters
     */
    applyFilters() {
        this.filteredData = this.currentData.filter(request => {
            // Domain filter
            if (this.filters.domain && request.domain !== this.filters.domain) {
                return false;
            }
            
            // Status filter
            if (this.filters.status) {
                const status = request.status;
                const statusCategory = getStatusCategory(status);
                if (statusCategory !== this.filters.status) {
                    return false;
                }
            }
            
            // Type filter
            if (this.filters.type && request.type !== this.filters.type) {
                return false;
            }
            
            return true;
        });

        // Refresh filter options
        this.updateFilterOptions();
    }

    /**
     * Refresh filter options
     */
    updateFilterOptions() {
        // Refresh domain options
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
     * Clear filters
     */
    clearFilters() {
        // Reset internal filter state
        this.filters = { domain: '', status: '', type: '' };
        
        // Reset the UI controls
        document.getElementById('domainFilter').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('typeFilter').value = '';
        
        // Reapply filters, which effectively shows all data
        this.applyFilters();
        this.updateTable();
        this.updateStats();
        
        this.showSuccess('Filters cleared - showing all data');
    }

    /**
     * Update the table
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
            
            // Read the current download state
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
          // Attach Save button listeners
        this.addSaveButtonListeners();
        
        // Refresh the select-all checkbox state
        this.updateSelectAllCheckbox();
    }

    /**
     * Attach Save button listeners
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
     * Format file size
     */
    formatSize(bytes) {
        if (!bytes || bytes <= 0) return '-';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Update summary stats
     */
    updateStats() {
        document.getElementById('captureCount').textContent = this.currentData.length;
        document.getElementById('filteredCount').textContent = this.filteredData.length;
        document.getElementById('footerFilteredCount').textContent = this.filteredData.length;
        document.getElementById('totalRequests').textContent = this.currentData.length;
        
        // Estimate memory usage
        const memoryKB = Math.round(JSON.stringify(this.currentData).length / 1024);
        document.getElementById('memoryUsage').textContent = `${memoryKB} KB`;
        
        // Refresh the exportable-resource count
        this.updateExportResourcesButton();
    }    /**
     * Update the Export Resources button state
     */
    updateExportResourcesButton() {
        const exportResourcesBtn = document.getElementById('exportResourcesButton');
        if (!exportResourcesBtn) return;

        // Use the number of selected downloadable resources
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
     * Update capture-state UI
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
     * Clear captured data
     */
    async clearData() {
        const requestCount = this.currentData.length;

        if (requestCount === 0) {
            this.showError('No data to clear');
            return;
        }

        const confirmed = await this.showConfirmDialog({
            title: 'Clear Captured Data',
            message: `This will permanently remove all ${requestCount} captured requests from the current session.`,
            confirmLabel: 'Clear Data',
            danger: true
        });

        if (!confirmed) return;

        chrome.runtime.sendMessage({ message: 'clear_requests' }, (response) => {
            if (response && response.success) {
                const domainToClear = this.currentTargetDomain;
                this.currentData = [];
                this.filteredData = [];
                this.downloadStatus.clear();
                this.clearPersistedDownloadStatus(domainToClear).catch(() => {});
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
     * Export data
     */    /**
     * Export data as a simplified URL array
     */
    exportData() {
        if (this.filteredData.length === 0) {
            this.showError('No data to export');
            return;
        }

        // Export only selected downloadable resource URLs
        const selectedDownloadableUrls = this.filteredData
            .filter(request => isDownloadableResource(request) && !this.excludedResources.has(request.url))
            .map(request => request.url);

        if (selectedDownloadableUrls.length === 0) {
            this.showError('No selected downloadable resources found to export');
            return;
        }

        // Build simplified JSON containing only URLs
        const dataStr = JSON.stringify(selectedDownloadableUrls, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        // Generate a timestamped filename
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
     * Save a single resource
     */
    async saveIndividualResource(url, index) {
        // Resolve the resource from the filtered dataset
        const resource = this.filteredData[index];
        if (!resource || resource.url !== url) {
            this.showToast('Resource not found', 'error');
            return;
        }

        // Ensure the resource type is downloadable
        if (!isDownloadableResource(resource)) {
            this.showToast('This resource type is not downloadable', 'warning');
            return;
        }        try {
            // Step 1: mark the row as downloading
            this.updateResourceStatus(index, 'downloading');
            
            // Step 2: open the directory picker
            debugLog('Opening folder picker for resource:', resource.url);
              if (window.showDirectoryPicker) {
                // Explain the browser fallback behavior first
                this.showToast('📁 Note: Due to browser security, some files may be saved to Downloads folder with organized structure', 'info');
                
                const directoryHandle = await window.showDirectoryPicker({
                    mode: 'readwrite'
                });
                  debugLog('User selected folder:', directoryHandle.name);
                this.showToast(`Selected folder: ${directoryHandle.name}`, 'success');                // Step 3: save the resource using the best available path
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
     * Save a resource intelligently, falling back to Downloads when needed
     */
    async saveResourceSmart(resource, directoryHandle, index) {
        try {
            // Try writing directly into the selected directory first
            await this.saveResourceToUserDirectory(resource, directoryHandle, index);
        } catch (error) {
            debugLog('Direct save failed, falling back to Downloads API:', error.message);
            // Fall back to the Downloads API
            this.showToast('⚠️ Using Downloads folder due to browser restrictions...', 'warning');
            await this.saveResourceWithDownloadsAPI(resource, directoryHandle.name, index);
        }
    }

    /**
     * Save a resource into the user-selected directory
     */
    async saveResourceToUserDirectory(resource, directoryHandle, index) {
        try {
            // Comment
            const url = new URL(resource.url);
            const domain = url.hostname;
            const pathname = url.pathname;
            
            debugLog('Saving resource to user directory:');
            debugLog('  Domain:', domain);
            debugLog('  Path:', pathname);
            
            // Comment
            const pathSegments = pathname.split('/').filter(segment => segment !== '');
            debugLog('  Path segments:', pathSegments);
            
            // Comment
            let currentHandle = directoryHandle;
            
            // Comment
            try {
                const domainHandle = await currentHandle.getDirectoryHandle(domain, { create: true });
                currentHandle = domainHandle;
                debugLog('  Created/accessed domain folder:', domain);
            } catch (error) {
                console.error('Failed to create domain folder:', error);
                throw new Error(`Failed to create domain folder: ${domain}`);
            }
            
            // Comment
            if (pathSegments.length > 1) {
                const directorySegments = pathSegments.slice(0, -1); // Comment
                
                for (const segment of directorySegments) {
                    if (segment && segment.trim() !== '') {
                        try {
                            const segmentHandle = await currentHandle.getDirectoryHandle(segment, { create: true });
                            currentHandle = segmentHandle;
                            debugLog('  Created/accessed path folder:', segment);
                        } catch (error) {
                            console.error(`Failed to create path folder: ${segment}`, error);
                            // Comment
                        }
                    }
                }
            }            // Comment
            debugLog('  Fetching resource data...');
            
            // Comment
            let blob;
            const response = await fetch(resource.url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            blob = await response.blob();
              // Comment
            const filename = generateFilename(resource, index + 1);
            debugLog('  Generated filename:', filename);
            
            // Comment
            debugLog('  Getting file data...');
            
            // Comment
            const fileHandle = await currentHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            
            await writable.write(blob);
            await writable.close();
            
            // Comment
            this.updateResourceStatus(index, 'completed');
            
            // Comment
            const directoryPath = [domain, ...pathSegments.slice(0, -1)].filter(p => p).join('/');
            this.showToast(`✅ File saved: ${directoryPath}/${filename}`, 'success');
              } catch (error) {
            console.error('Failed to save resource to user directory:', error);
            this.updateResourceStatus(index, 'failed');
            // Comment
            throw error;
        }
    }    /**
     * Comment
     */
    async saveResourceWithDownloadsAPI(resource, folderName, index) {
        try {
            // Comment
            const url = new URL(resource.url);
            const domain = url.hostname;
            const pathname = url.pathname;
            
            // Comment
            const pathSegments = pathname.split('/').filter(segment => segment !== '');
            const directorySegments = pathSegments.slice(0, -1); // Comment
            
            let directoryPath = domain;
            if (directorySegments.length > 0) {
                directoryPath += '/' + directorySegments.join('/');
            }
            
            // Comment
            const filename = generateFilename(resource, index + 1);
            
            // Comment
            const fullPath = `${folderName}/${directoryPath}/${filename}`;
            
            debugLog('Downloading resource to:', fullPath);
            
            // Comment
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
                        
                        // Comment
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
                        
                        // Comment
                        setTimeout(() => {
                            chrome.downloads.onChanged.removeListener(onDownloadChanged);
                            this.updateResourceStatus(index, 'failed');
                            reject(new Error('Download timeout'));
                        }, 30000); // Comment
                    }
                });
            });
            
            // Comment
            this.showToast(`✅ File saved: Downloads/${fullPath}`, 'success');
            
        } catch (error) {
            console.error('Failed to save resource:', error);
            this.updateResourceStatus(index, 'failed');
            this.showToast('❌ Failed to save file: ' + error.message, 'error');
        }
    }

    /**
     * Comment
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
     * Comment
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
     * Comment
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
     * Comment
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
     * Comment
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
     * Comment
     */
    sleep(ms) {
        return sleep(ms);
    }

    /**
     * Comment
     */
    toggleSettings() {
        const panel = document.getElementById('settingsPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        if (panel.style.display === 'block') {
            this.updateSettingsUI();
        }
    }

    /**
     * Comment
     */
    updateSettingsUI() {
        document.getElementById('maxRequestsSetting').value = this.settings.maxRequests;
        document.getElementById('saveDetailsSetting').checked = this.settings.saveDetails;
        document.getElementById('blockAdsSetting').checked = this.settings.blockAds;
        document.getElementById('blockStaticSetting').checked = this.settings.blockStatic;
        document.getElementById('defaultViewSetting').value = this.settings.defaultView || 'popup';
        document.getElementById('captureModeSelect').value = this.settings.captureMode || 'all_domains';
        
        // Comment
        if (this.settings.allowedDomains) {
            document.getElementById('allowedDomainsInput').value = this.settings.allowedDomains.join('\n');
        }
        
        // Comment
        this.toggleWhitelistSettings(this.settings.captureMode === 'whitelist');
        
        // Comment
        this.loadBlockedDomains();
    }

    /**
     * Comment
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
     * Comment
     */
    closeSettings() {
        document.getElementById('settingsPanel').style.display = 'none';
    }

    /**
     * Comment
     */
    toggleWhitelistSettings(show) {
        const container = document.getElementById('whitelistContainer');
        if (container) {
            container.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * Comment
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
     * Comment
     */
    updateUI() {
        this.updateCaptureState();
        this.updateStats();
        
        // Comment
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
     * Comment
     */
    async resetSession() {
        const confirmed = await this.showConfirmDialog({
            title: 'Reset Current Session',
            message: 'This will stop capture, clear the active domain session, remove the saved URL, and return the extension to a fresh stopped state.',
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
                this.isCapturing = false;
                this.isBatchExporting = false;
                this.resetVisibleCaptureContext();
                chrome.storage.local.remove(['lastUrl']);
                this.updateTable();
                this.updateStats();
                this.updateCaptureState();
                this.showSuccess('Session reset and capture stopped');
            } else {
                this.showError('Failed to reset session');
            }
        });
    }
    /**
     * Comment
     */
    showError(message) {
        showError(message);
    }/**
     * Comment
     */
    showSuccess(message) {
        showSuccess(message);
    }

    /**
     * Comment
     */
    showToast(message, type = 'info') {
        showToast(message, type);
    }

    /**
     * Comment
     */
    openWindow() {
        debugLog('DevTrace: Opening standalone window...');
        const currentUrl = document.getElementById('urlInput')?.value?.trim() || '';
        chrome.runtime.sendMessage({ message: 'open_window', url: currentUrl }, (response) => {
            if (response && response.success) {
                debugLog('DevTrace: Standalone window opened successfully');
                // Comment
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

    closeWindow() {
        chrome.runtime.sendMessage({ message: 'close_window' }, (response) => {
            if (response && response.success) {
                window.close();
            } else {
                this.showError(response?.error || 'Failed to close floating window');
            }
        });
    }

    /**
     * Comment
     */
    isPopupMode() {
        // Comment
        return !this.isWindowMode() && window.outerWidth <= 850 && window.outerHeight <= 650;
    }

    /**
     * Comment
     */
    async saveResourceWithChromeDownloads(resource, batchFolderName, index, fileNumber) {
        try {
            this.setDownloadStatus(resource.url, 'downloading');
            // Parse the URL into a domain and path
            const url = new URL(resource.url);
            const domain = url.hostname;
            const pathname = url.pathname;
            
            // Comment
            const pathSegments = pathname.split('/').filter(segment => segment !== '');
            const directorySegments = pathSegments.slice(0, -1); // Comment
            
            let directoryPath = domain;
            if (directorySegments.length > 0) {
                directoryPath += '/' + directorySegments.join('/');
            }
            
            // Comment
            const filename = generateFilename(resource, fileNumber);
            
            // Comment
            const fullPath = `${batchFolderName}/${directoryPath}/${filename}`;
            
            debugLog('Batch downloading resource to:', fullPath);
            
            // Comment
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
                        
                        // Comment
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
                        
                        // Comment
                        setTimeout(() => {
                            chrome.downloads.onChanged.removeListener(onDownloadChanged);
                            if (index !== -1) {
                                this.updateResourceStatus(index, 'failed');
                            } else {
                                this.setDownloadStatus(resource.url, 'failed');
                            }
                            reject(new Error('Download timeout'));
                        }, 30000); // Comment
                    }
                });
            });
            
            // Comment
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
     * Comment
     */
    addDragFunctionality() {
        if (this.isPopupMode()) {
            return;
        }

        const header = document.querySelector('.header');
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        header.style.cursor = 'move';
        header.style.userSelect = 'none';

        header.addEventListener('mousedown', (e) => {
            // Comment
            if (e.target.closest('.url-section') || e.target.closest('.window-controls')) {
                return;
            }
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            // Comment
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
     * Comment
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
        
        // Comment
        const selectedCount = this.getSelectedResourcesCount();
        this.showToast(`${checked ? 'Selected' : 'Deselected'} all resources (${selectedCount} items)`, 'info');
    }

    /**
     * Comment
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
        
        // Comment
        this.updateSelectAllCheckbox();
        this.updateExportResourcesButton();
    }

    /**
     * Comment
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
     * Comment
     */
    getSelectedResourcesCount() {
        return this.getPendingBatchResources().length;
    }

    /**
     * Comment
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
        const manifest = chrome.runtime.getManifest();
        const homepage = manifest.homepage_url ? manifest.homepage_url.replace(/\/+$/, '') : '';
        const url = homepage ? `${homepage}/support.html` : chrome.runtime.getURL('help.html');
        chrome.tabs.create({ url });
    }
}

// Comment
document.addEventListener('DOMContentLoaded', () => {
    new WebRequestCaptureApp();
});
