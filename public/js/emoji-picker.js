// Custom emoji picker module
// Replaces emoji-picker-element with a configurable picker supporting custom tabs,
// category exclusion, emoji filtering, and pre-seedable recently-used.

const STANDARD_GROUPS = [
    { id: 0, name: 'smileys',    label: 'Smileys & Emotion', icon: '\u{1F600}' },
    { id: 1, name: 'people',     label: 'People & Body',     icon: '\u{1F44B}' },
    // group 2 is "Component" (skin tones, hair) - intentionally excluded
    { id: 3, name: 'animals',    label: 'Animals & Nature',  icon: '\u{1F431}' },
    { id: 4, name: 'food',       label: 'Food & Drink',      icon: '\u{1F34E}' },
    { id: 5, name: 'travel',     label: 'Travel & Places',   icon: '\u{1F3E0}' },
    { id: 6, name: 'activities', label: 'Activities',         icon: '\u26BD' },
    { id: 7, name: 'objects',    label: 'Objects',            icon: '\u{1F4DD}' },
    { id: 8, name: 'symbols',    label: 'Symbols',            icon: '\u2764\uFE0F' },
    { id: 9, name: 'flags',      label: 'Flags',              icon: '\u{1F3C1}' }
];

// Module-level cache for emoji data
let emojiData = null;
let searchIndex = null;

async function loadEmojiData() {
    if (emojiData) return;
    const resp = await fetch('/data/emoji-data.json');
    emojiData = await resp.json();
    buildSearchIndex();
}

function buildSearchIndex() {
    searchIndex = [];
    for (const entry of emojiData) {
        // Skip component group (skin tones, hair)
        if (entry.group === 2) continue;

        const parts = [];
        if (entry.annotation) {
            for (const w of entry.annotation.split(/[\s_-]+/)) {
                const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (clean) parts.push(clean);
            }
        }
        if (entry.tags) {
            for (const t of entry.tags) {
                for (const w of t.split(/[\s_-]+/)) {
                    const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (clean) parts.push(clean);
                }
            }
        }
        if (entry.shortcodes) {
            for (const s of entry.shortcodes) {
                for (const w of s.split(/[\s_-]+/)) {
                    const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (clean) parts.push(clean);
                }
            }
        }

        searchIndex.push({
            emoji: entry.emoji,
            annotation: entry.annotation || '',
            group: entry.group,
            order: entry.order,
            tokens: [...new Set(parts)]
        });
    }
}

const DEFAULT_OPTIONS = {
    customTabs: [],
    recentlyUsed: {
        enabled: true,
        maxCount: 32,
        storageKey: 'electron-recent-emoji',
        defaultEmoji: []
    },
    excludeCategories: [],
    includeEmoji: null,
    excludeEmoji: null,
    onEmojiClick: function () {}
};

export default class EmojiPicker {
    constructor(container, options) {
        this.container = container;
        this.options = Object.assign({}, DEFAULT_OPTIONS, options);
        // Deep-merge recentlyUsed since it's nested
        this.options.recentlyUsed = Object.assign(
            {}, DEFAULT_OPTIONS.recentlyUsed,
            options && options.recentlyUsed ? options.recentlyUsed : {}
        );

        this.el = null;
        this.tabBar = null;
        this.gridArea = null;
        this.recentSection = null;
        this.searchInput = null;
        this.activeTab = null;
        this.searchQuery = '';
        this.recentEmoji = [];
        this._searchTimeout = null;

        // Expand 'all' shorthand for excludeCategories
        if (this.options.excludeCategories === 'all') {
            this.options.excludeCategories = STANDARD_GROUPS.map(function (g) { return g.name; });
        }

        // Pre-compute filter sets
        this._includeSet = this.options.includeEmoji ? new Set(this.options.includeEmoji) : null;
        this._excludeSet = this.options.excludeEmoji ? new Set(this.options.excludeEmoji) : null;

        this._init();
    }

    async _init() {
        await loadEmojiData();
        this._loadRecent();
        this._buildDOM();
        this._selectDefaultTab();
    }

    // --- Recently Used ---

    _loadRecent() {
        const opts = this.options.recentlyUsed;
        if (!opts.enabled) { this.recentEmoji = []; return; }

        try {
            const stored = localStorage.getItem(opts.storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.recentEmoji = parsed.slice(0, opts.maxCount);
                    return;
                }
            }
        } catch (e) { /* ignore corrupt storage */ }

        this.recentEmoji = (opts.defaultEmoji || []).slice(0, opts.maxCount);
    }

    _saveRecent() {
        const opts = this.options.recentlyUsed;
        if (!opts.enabled) return;
        try {
            localStorage.setItem(opts.storageKey, JSON.stringify(this.recentEmoji));
        } catch (e) { /* storage full or disabled */ }
    }

    _addToRecent(unicode) {
        const opts = this.options.recentlyUsed;
        if (!opts.enabled) return;
        this.recentEmoji = [unicode, ...this.recentEmoji.filter(function (e) { return e !== unicode; })];
        if (this.recentEmoji.length > opts.maxCount) {
            this.recentEmoji = this.recentEmoji.slice(0, opts.maxCount);
        }
        this._saveRecent();
        this._renderRecent();
    }

    // --- DOM Construction ---

    _buildDOM() {
        this.el = document.createElement('div');
        this.el.className = 'emoji-picker';

        // Search bar
        var searchWrap = document.createElement('div');
        searchWrap.className = 'ep-search';
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = 'Search emoji...';
        var self = this;
        this.searchInput.addEventListener('input', function () { self._onSearchInput(); });
        searchWrap.appendChild(this.searchInput);
        this.el.appendChild(searchWrap);

        // Tab bar (hidden when only one tab exists)
        this.tabBar = document.createElement('div');
        this.tabBar.className = 'ep-tabs';
        this._buildTabs();
        if (this.tabBar.children.length > 1) {
            this.el.appendChild(this.tabBar);
        }

        // Grid area (scrollable)
        this.gridArea = document.createElement('div');
        this.gridArea.className = 'ep-grid-area';
        this.el.appendChild(this.gridArea);

        // Recently used (fixed at bottom)
        if (this.options.recentlyUsed.enabled) {
            this.recentSection = document.createElement('div');
            this.recentSection.className = 'ep-recent';

            var label = document.createElement('div');
            label.className = 'ep-recent-label';
            label.textContent = 'Recently Used';
            this.recentSection.appendChild(label);

            this.recentRow = document.createElement('div');
            this.recentRow.className = 'ep-recent-row';
            this.recentSection.appendChild(this.recentRow);

            this.el.appendChild(this.recentSection);
            this._renderRecent();
        }

        // Prevent clicks inside picker from bubbling (so outside-click-to-close works)
        this.el.addEventListener('click', function (e) { e.stopPropagation(); });

        this.container.appendChild(this.el);
    }

    _buildTabs() {
        var self = this;

        // Custom tabs first (left side)
        for (var i = 0; i < this.options.customTabs.length; i++) {
            var tab = this.options.customTabs[i];
            this._addTab('custom-' + tab.id, tab.icon, tab.label);
        }

        // Standard group tabs (excluding excluded categories and group 2)
        var excluded = this.options.excludeCategories;
        for (var j = 0; j < STANDARD_GROUPS.length; j++) {
            var group = STANDARD_GROUPS[j];
            if (excluded.indexOf(group.name) === -1) {
                this._addTab('group-' + group.id, group.icon, group.label);
            }
        }
    }

    _addTab(id, icon, title) {
        var self = this;
        var btn = document.createElement('button');
        btn.className = 'ep-tab';
        btn.dataset.tabId = id;
        btn.title = title;
        btn.textContent = icon;
        btn.addEventListener('click', function () { self._selectTab(id); });
        this.tabBar.appendChild(btn);
    }

    _selectDefaultTab() {
        var firstTab = this.tabBar.querySelector('.ep-tab');
        if (firstTab) {
            this._selectTab(firstTab.dataset.tabId);
        }
    }

    _selectTab(tabId) {
        this.activeTab = tabId;
        this.searchInput.value = '';
        this.searchQuery = '';

        var tabs = this.tabBar.querySelectorAll('.ep-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].dataset.tabId === tabId);
        }

        this._renderContent();
        this.gridArea.scrollTop = 0;
    }

    // --- Search ---

    _onSearchInput() {
        var self = this;
        clearTimeout(this._searchTimeout);
        this._searchTimeout = setTimeout(function () {
            self.searchQuery = self.searchInput.value.trim().toLowerCase();
            self._renderContent();
        }, 150);
    }

    // --- Filtering ---

    _getFilteredEmoji() {
        var result = searchIndex;

        if (this._includeSet) {
            var incl = this._includeSet;
            result = result.filter(function (e) { return incl.has(e.emoji); });
        }
        if (this._excludeSet) {
            var excl = this._excludeSet;
            result = result.filter(function (e) { return !excl.has(e.emoji); });
        }

        return result;
    }

    // --- Rendering ---

    _renderContent() {
        this.gridArea.innerHTML = '';

        if (this.searchQuery.length >= 2) {
            this._renderSearchResults();
            return;
        }

        if (!this.activeTab) return;

        // Custom tab?
        if (this.activeTab.indexOf('custom-') === 0) {
            var customId = this.activeTab.slice(7);
            var customTab = null;
            for (var i = 0; i < this.options.customTabs.length; i++) {
                if (this.options.customTabs[i].id === customId) {
                    customTab = this.options.customTabs[i];
                    break;
                }
            }
            if (customTab) {
                this._renderEmojiGrid(customTab.emoji.map(function (u) {
                    return { emoji: u, annotation: '' };
                }));
            }
            return;
        }

        // Standard group tab
        var match = this.activeTab.match(/^group-(\d+)$/);
        if (match) {
            var groupId = parseInt(match[1]);
            var filtered = this._getFilteredEmoji()
                .filter(function (e) { return e.group === groupId; })
                .sort(function (a, b) { return a.order - b.order; });
            this._renderEmojiGrid(filtered);
        }
    }

    _renderSearchResults() {
        var queryTokens = this.searchQuery.split(/\s+/).filter(Boolean);
        if (queryTokens.length === 0) return;

        // Search across all non-excluded groups, respecting include/exclude filters
        var filtered = this._getFilteredEmoji();

        // Also include custom tab emoji in search by looking them up in the index
        var filteredSet = new Set(filtered.map(function (e) { return e.emoji; }));
        var customExtra = [];
        for (var i = 0; i < this.options.customTabs.length; i++) {
            var tab = this.options.customTabs[i];
            for (var j = 0; j < tab.emoji.length; j++) {
                if (!filteredSet.has(tab.emoji[j])) {
                    // Look up in search index for tokens
                    var indexed = searchIndex.find(function (e) { return e.emoji === tab.emoji[j]; });
                    if (indexed) customExtra.push(indexed);
                }
            }
        }

        var allEmoji = filtered.concat(customExtra);

        var results = allEmoji.filter(function (entry) {
            return queryTokens.every(function (qt) {
                return entry.tokens.some(function (token) {
                    return token.indexOf(qt) === 0;
                });
            });
        }).sort(function (a, b) { return a.order - b.order; });

        this._renderEmojiGrid(results);
    }

    _renderEmojiGrid(emojiList) {
        var grid = document.createElement('div');
        grid.className = 'ep-grid';
        var self = this;

        for (var i = 0; i < emojiList.length; i++) {
            (function (entry) {
                var btn = document.createElement('button');
                btn.className = 'ep-emoji';
                btn.textContent = entry.emoji;
                btn.title = entry.annotation || '';
                btn.addEventListener('click', function () { self._onEmojiClick(entry); });
                grid.appendChild(btn);
            })(emojiList[i]);
        }

        if (emojiList.length === 0) {
            var msg = document.createElement('div');
            msg.className = 'ep-no-results';
            msg.textContent = 'No emoji found';
            grid.appendChild(msg);
        }

        this.gridArea.appendChild(grid);
    }

    _renderRecent() {
        if (!this.recentRow) return;
        this.recentRow.innerHTML = '';
        var self = this;

        for (var i = 0; i < this.recentEmoji.length; i++) {
            (function (unicode) {
                var btn = document.createElement('button');
                btn.className = 'ep-emoji';
                btn.textContent = unicode;
                btn.addEventListener('click', function () {
                    self._onEmojiClick({ emoji: unicode, annotation: '' });
                });
                self.recentRow.appendChild(btn);
            })(this.recentEmoji[i]);
        }

        // Hide the section if there are no recent emoji
        if (this.recentSection) {
            this.recentSection.style.display = this.recentEmoji.length > 0 ? '' : 'none';
        }
    }

    // --- Events ---

    _onEmojiClick(entry) {
        this._addToRecent(entry.emoji);
        this.options.onEmojiClick({ unicode: entry.emoji, annotation: entry.annotation || '' });
    }

    // --- Public API ---

    destroy() {
        clearTimeout(this._searchTimeout);
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
    }
}
