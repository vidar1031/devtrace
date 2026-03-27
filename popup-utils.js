window.DevTracePopupUtils = (() => {
    function isValidDomain(domain) {
        const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

        if (!domainRegex.test(domain)) {
            return false;
        }

        if (!domain.includes('.') && !['localhost', 'local'].includes(domain.toLowerCase())) {
            return false;
        }

        return true;
    }

    function getStatusCategory(status) {
        if (status >= 200 && status < 300) return '2xx';
        if (status >= 300 && status < 400) return '3xx';
        if (status >= 400 && status < 500) return '4xx';
        if (status >= 500) return '5xx';
        return 'unknown';
    }

    function isDownloadableResource(request) {
        const url = request.url.toLowerCase();

        const excludePatterns = [
            '/cdn-cgi/',
            '/rum?',
            '/beacon',
            '/analytics',
            '/tracking',
            '/metrics',
            '/telemetry',
            '/api/',
            '/ajax/',
            '/graphql',
            '/rpc/',
            '/jsonrpc',
            '/ads/',
            '/advertisement',
            '/doubleclick',
            '/googletagmanager',
            '/googlesyndication',
            '/collect?',
            '/ping?',
            '/health',
            '/status',
            '/monitor',
            '.php?',
            '.asp?',
            '.jsp?',
            '.cgi?',
            '/ws/',
            '/socket.io/',
            '/sockjs/',
            '/favicon.ico',
            '/robots.txt',
            '/sitemap.xml'
        ];

        return !excludePatterns.some(pattern => url.includes(pattern));
    }

    function getExtensionFromUrl(url) {
        try {
            const urlLower = url.toLowerCase();
            const commonExtensions = [
                '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.avif',
                '.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.wma', '.opus',
                '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.3gp', '.mpg', '.mpeg',
                '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf',
                '.css', '.js', '.json', '.xml', '.yaml', '.yml', '.html', '.htm',
                '.ttf', '.woff', '.woff2', '.eot', '.otf',
                '.obj', '.fbx', '.dae', '.blend', '.unity3d', '.asset', '.lm', '.model',
                '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
                '.bin', '.dat', '.bundle', '.pak', '.cache', '.db'
            ];

            for (const ext of commonExtensions) {
                if (urlLower.includes(ext)) {
                    return ext;
                }
            }

            return '.bin';
        } catch {
            return '.bin';
        }
    }

    function sanitizeFilename(filename) {
        if (!filename) return '';

        return filename
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_+|_+$/g, '')
            .substring(0, 200);
    }

    function generateFilename(resource, index) {
        try {
            const url = new URL(resource.url);
            let filename = url.pathname.split('/').pop();

            if (!filename || filename === '') {
                filename = url.searchParams.get('filename') ||
                    url.searchParams.get('name') ||
                    url.searchParams.get('file');
            }

            if (!filename || filename === '') {
                const pathSegments = url.pathname.split('/').filter(segment => segment !== '');
                if (pathSegments.length > 0) {
                    filename = pathSegments[pathSegments.length - 1];
                }
            }

            if (!filename || filename === '') {
                const ext = getExtensionFromUrl(resource.url);
                filename = `resource_${index}_${Date.now()}${ext}`;
            }

            if (!filename.includes('.')) {
                const ext = getExtensionFromUrl(resource.url);
                if (ext) {
                    filename += ext;
                }
            }

            filename = sanitizeFilename(filename);

            if (!filename || filename === '' || filename === '.') {
                filename = `resource_${index}_${Date.now()}.bin`;
            }

            return filename;
        } catch {
            return `resource_${index}_${Date.now()}.bin`;
        }
    }

    return {
        isValidDomain,
        getStatusCategory,
        isDownloadableResource,
        generateFilename,
        sanitizeFilename
    };
})();
