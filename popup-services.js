window.DevTracePopupServices = (() => {
    const TOAST_COLORS = {
        success: '#27ae60',
        error: '#e74c3c',
        warning: '#f39c12',
        info: '#3498db'
    };

    function sendRuntimeMessage(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(message, (response) => {
                resolve(response);
            });
        });
    }

    function getStorageValue(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => resolve(result || {}));
        });
    }

    function setStorageValue(values) {
        return new Promise((resolve) => {
            chrome.storage.local.set(values, () => resolve());
        });
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function ensureToastAnimationStyle() {
        if (document.getElementById('toast-animation-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'toast-animation-style';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    function showToast(message, type = 'info', duration) {
        ensureToastAnimationStyle();

        const backgroundColor = TOAST_COLORS[type] || TOAST_COLORS.info;
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${backgroundColor};
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            font-size: 13px;
            z-index: 10000;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            animation: slideIn 0.3s ease-out;
            max-width: 300px;
            word-wrap: break-word;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        const timeout = duration ?? (type === 'error' ? 5000 : 3000);
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, timeout);
    }

    function showSuccess(message) {
        showToast(message, 'success', 3000);
    }

    function showError(message) {
        console.error(message);
        showToast(message, 'error', 5000);
    }

    return {
        getStorageValue,
        sendRuntimeMessage,
        setStorageValue,
        showError,
        showSuccess,
        showToast,
        sleep
    };
})();
