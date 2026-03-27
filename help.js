const DONATION_LINKS = [
    { label: 'Support via PayPal', url: 'https://paypal.me/Vidar1031' }
];

function renderVersion() {
    try {
        const manifest = chrome.runtime.getManifest();
        const versionNodes = document.querySelectorAll('[data-app-version]');
        versionNodes.forEach((node) => {
            node.textContent = `v${manifest.version}`;
        });
        document.title = `DevTrace Help v${manifest.version}`;
    } catch (error) {
        console.error('Failed to render help page version:', error);
    }
}

function openExternalUrl(url) {
    chrome.tabs.create({ url });
}

function renderSupportLinks() {
    const supportLinks = document.getElementById('supportLinks');
    const donationLinks = document.getElementById('donationLinks');
    const donationHint = document.getElementById('donationHint');
    const manifest = chrome.runtime.getManifest();

    if (supportLinks && manifest.homepage_url) {
        const homepageButton = document.createElement('button');
        homepageButton.className = 'help-link-button';
        homepageButton.textContent = 'Project Homepage';
        homepageButton.addEventListener('click', () => openExternalUrl(manifest.homepage_url));
        supportLinks.appendChild(homepageButton);
    }

    const configuredLinks = DONATION_LINKS.filter((item) => item.url && item.url.trim());
    if (!donationLinks || !donationHint) {
        return;
    }

    if (configuredLinks.length === 0) {
        donationHint.textContent = 'No donation link is currently configured.';
        return;
    }

    donationHint.textContent = 'Support is optional, user-initiated, and does not affect core functionality.';
    configuredLinks.forEach((item) => {
        const button = document.createElement('button');
        button.className = 'donation-button';
        button.textContent = item.label;
        button.addEventListener('click', () => openExternalUrl(item.url));
        donationLinks.appendChild(button);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    renderVersion();
    renderSupportLinks();
});
