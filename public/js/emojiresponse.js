import '/vendor/emoji-picker-element/picker.js';

const DEFAULT_EMOJI = "❔️";

$(document).ready(function () {
    const currentEmoji = document.getElementById('current-emoji');
    const clearBtn = document.getElementById('emoji-clear-btn');
    const popup = document.getElementById('emoji-picker-popup');

    let picker = null;

    clearEmoji(DEFAULT_EMOJI);

    function openPicker() {
        if (!picker) {
            picker = document.createElement('emoji-picker');
            popup.appendChild(picker);
            picker.addEventListener('emoji-click', function (e) {
                setEmoji(e.detail.unicode);
                closePicker();
            });
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
