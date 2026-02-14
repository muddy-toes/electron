import EmojiPicker from './emoji-picker.js';

const DEFAULT_EMOJI = "\u2754\uFE0F";

$(document).ready(function () {
    const currentEmoji = document.getElementById('current-emoji');
    const clearBtn = document.getElementById('emoji-clear-btn');
    const popup = document.getElementById('emoji-picker-popup');

    let picker = null;

    clearEmoji(DEFAULT_EMOJI);

    function buildPickerOptions() {
        // Read server-provided config (set in player.ejs from config.js emojiPicker section)
        const cfg = (typeof emojiPickerConfig !== 'undefined') ? emojiPickerConfig : {};

        const options = {
            onEmojiClick: function (emoji) {
                setEmoji(emoji.unicode);
                closePicker();
            }
        };

        if (cfg.customTabs) {
            options.customTabs = cfg.customTabs;
        }

        if (cfg.recentlyUsed) {
            options.recentlyUsed = cfg.recentlyUsed;
        }

        if (cfg.excludeCategories) {
            options.excludeCategories = cfg.excludeCategories;
        }

        if (cfg.includeEmoji) {
            options.includeEmoji = cfg.includeEmoji;
        }

        if (cfg.excludeEmoji) {
            options.excludeEmoji = cfg.excludeEmoji;
        }

        return options;
    }

    function openPicker() {
        if (!picker) {
            picker = new EmojiPicker(popup, buildPickerOptions());
        }
        popup.classList.add('open');

        // close on outside click
        setTimeout(function () {
            document.addEventListener('click', outsideClickHandler);
        }, 0);
    }

    function closePicker() {
        popup.classList.remove('open');
        document.removeEventListener('click', outsideClickHandler);
    }

    function outsideClickHandler(e) {
        if (!popup.contains(e.target)) {
            closePicker();
        }
    }

    function setEmoji(emoji) {
        currentEmoji.textContent = emoji;
        $(window).trigger('emoji-response', [emoji]);
    }

    function clearEmoji() {
        setEmoji(DEFAULT_EMOJI);
    }

    clearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        clearEmoji();
        closePicker();
    });

    // clicking the emoji itself also opens the picker
    currentEmoji.addEventListener('click', function (e) {
        e.stopPropagation();
        openPicker();
    });
});
