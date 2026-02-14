# EmojiPicker

A lightweight, configurable emoji picker built as an ES module. Supports custom category tabs, searchable emoji, recently-used tracking with pre-seeding, and category/emoji filtering.

## Quick Start

```html
<link rel="stylesheet" href="/css/emoji-picker.css">
<script type="module">
import EmojiPicker from './js/emoji-picker.js';

const container = document.getElementById('my-picker-container');
const picker = new EmojiPicker(container, {
    onEmojiClick: function(emoji) {
        console.log('Selected:', emoji.unicode, emoji.annotation);
    }
});
</script>
```

The picker appends itself to the container element and loads emoji data asynchronously from `/data/emoji-data.json`.

## Dependencies

- `/data/emoji-data.json` - Emojibase dataset (vendored from `emoji-picker-element-data`). Must be served as a static file.
- `/css/emoji-picker.css` - Picker styles.
- No external JS dependencies. No jQuery required.

## Constructor

```javascript
new EmojiPicker(containerElement, options)
```

**containerElement** - A DOM element to append the picker into.

**options** - Configuration object (all fields optional):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `customTabs` | Array | `[]` | Custom category tabs (see below) |
| `recentlyUsed` | Object | see below | Recently-used row configuration |
| `excludeCategories` | Array or `'all'` | `[]` | Standard category tabs to hide |
| `includeEmoji` | Array or null | `null` | Show only these emoji in standard tabs |
| `excludeEmoji` | Array or null | `null` | Hide these emoji from standard tabs |
| `onEmojiClick` | Function | no-op | Called when an emoji is selected |

## Options Detail

### customTabs

An array of custom category tab definitions. Custom tabs appear at the **left** side of the tab bar, before any standard category tabs. Each tab contains a curated set of native Unicode emoji.

```javascript
customTabs: [
    {
        id: 'reactions',        // Unique identifier (required)
        label: 'Reactions',     // Tooltip text (required)
        icon: '\u2B50',         // Tab button character (required)
        emoji: [                // Array of Unicode emoji strings (required)
            '\u2764\uFE0F',     // red heart
            '\uD83D\uDE00',     // grinning face
            '\uD83D\uDC4D',     // thumbs up
            '\uD83D\uDD25'      // fire
        ]
    },
    {
        id: 'moods',
        label: 'Moods',
        icon: '\uD83D\uDE0E',
        emoji: ['\uD83D\uDE0E', '\uD83D\uDE14', '\uD83E\uDD29', '\uD83D\uDE31']
    }
]
```

If custom tabs are defined and the picker opens, the **first custom tab** is selected by default. Custom emoji are also included in search results (they inherit search tokens from the emojibase dataset).

### recentlyUsed

Controls the "Recently Used" row fixed at the bottom of the picker.

```javascript
recentlyUsed: {
    enabled: true,                  // Show the row (default: true)
    maxCount: 32,                   // Max emoji to remember (default: 32)
    storageKey: 'my-recent-emoji',  // localStorage key (default: 'electron-recent-emoji')
    defaultEmoji: [                 // Fallback list when localStorage is empty
        '\u2764\uFE0F',
        '\uD83D\uDE00',
        '\uD83D\uDC4D'
    ]
}
```

- When the user selects an emoji, it moves to the front of the recently-used list.
- The list persists to `localStorage` under the configured key.
- If `localStorage` has no data (first visit or cleared), `defaultEmoji` is shown instead.
- Once the user makes their own selections, those replace the defaults.
- Set `enabled: false` to hide the row entirely.

### excludeCategories

Hide standard category tabs. Pass an array of category names:

```javascript
// Hide just flags
excludeCategories: ['flags']

// Hide multiple categories
excludeCategories: ['flags', 'symbols', 'food']

// Hide ALL standard categories (only custom tabs remain)
excludeCategories: 'all'
```

Valid category names:
- `'smileys'` - Smileys & Emotion
- `'people'` - People & Body
- `'animals'` - Animals & Nature
- `'food'` - Food & Drink
- `'travel'` - Travel & Places
- `'activities'` - Activities
- `'objects'` - Objects
- `'symbols'` - Symbols
- `'flags'` - Flags

### includeEmoji / excludeEmoji

Filter which emoji appear in the **standard category tabs**. These filters do NOT affect custom tabs or the recently-used row.

```javascript
// Only show these specific emoji in the standard tabs
includeEmoji: ['\u2764\uFE0F', '\uD83D\uDE00', '\uD83D\uDC4D', '\uD83D\uDD25']

// Or hide specific emoji from the standard tabs
excludeEmoji: ['\uD83D\uDCA9']
```

- `includeEmoji` and `excludeEmoji` are mutually exclusive in practice (use one or the other).
- Both accept arrays of Unicode emoji strings.
- Set to `null` (or omit) for no filtering.

### onEmojiClick

Called when any emoji is selected (from a tab, search results, or the recently-used row).

```javascript
onEmojiClick: function(emoji) {
    // emoji.unicode    - the emoji character, e.g. "\u2764\uFE0F"
    // emoji.annotation - description, e.g. "red heart" (empty for custom tab emoji)
    console.log(emoji.unicode);
}
```

## Methods

### destroy()

Removes the picker from the DOM and cleans up timers.

```javascript
picker.destroy();
```

## Layout

```
+----------------------------------+
| [Search input                  ] |
| [Custom] [Custom] [Std] [Std].. |  tab bar
+----------------------------------+
|                                  |
|  Emoji grid (scrollable)         |
|                                  |
+----------------------------------+
|  Recently Used (fixed row)       |
+----------------------------------+
```

- **Search bar** - Filters all emoji by name, tags, and shortcodes. Minimum 2 characters. Results show as a flat grid (no category grouping). Debounced at 150ms.
- **Tab bar** - Custom tabs on the left, standard categories on the right. Horizontally scrollable if needed. Active tab has a bottom border indicator.
- **Grid area** - 8-column grid of emoji buttons. Scrollable.
- **Recently Used** - Single horizontal row below the grid. Scrollable. Hidden if empty and no defaults are configured.

## Search

The picker tokenizes each emoji's annotation, tags, and shortcodes into lowercase tokens. Search uses prefix matching - every word in the query must match the start of at least one token.

Examples:
- "heart" matches "red heart", "beating heart", "heart with arrow"
- "grin face" matches "grinning face" (both "grin" and "face" are prefix matches)
- "cat" matches "cat", "cat face", "cat with wry smile"

## Theming

The picker ships with light mode styles in `emoji-picker.css`. For dark mode support, add overrides for the `.emoji-picker` and `.ep-*` classes in your dark mode stylesheet. The electron project includes dark mode overrides in `styles.dark.css`.

Key CSS classes for theming:

| Class | Element |
|-------|---------|
| `.emoji-picker` | Outer container (background, border, text color, box-shadow) |
| `.ep-search input` | Search input (background, color, border) |
| `.ep-tabs` | Tab bar (border-bottom) |
| `.ep-tab:hover` | Tab hover state (background) |
| `.ep-tab.active` | Active tab (border-bottom-color) |
| `.ep-grid-area` | Scrollable grid wrapper (scrollbar colors) |
| `.ep-emoji:hover` | Emoji hover state (background) |
| `.ep-no-results` | "No emoji found" message (color) |
| `.ep-recent` | Recently-used container (border-top) |
| `.ep-recent-label` | "Recently Used" label (color) |

## Data Source

The picker reads emoji data from `/data/emoji-data.json`, which is the emojibase English dataset. Each entry has:

- `emoji` - Unicode character
- `annotation` - Human-readable name
- `tags` - Search keywords
- `shortcodes` - Colon-style codes
- `group` - Category number (0=Smileys, 1=People, 3=Animals, 4=Food, 5=Travel, 6=Activities, 7=Objects, 8=Symbols, 9=Flags)
- `order` - Sort position within group

The data is fetched once on first picker creation and cached in memory.

## Complete Example

A picker with two custom tabs, pre-seeded recents, and all standard categories hidden except Smileys:

```javascript
const picker = new EmojiPicker(document.getElementById('container'), {
    customTabs: [
        {
            id: 'quick',
            label: 'Quick Reactions',
            icon: '\u26A1',
            emoji: ['\uD83D\uDC4D', '\uD83D\uDC4E', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83D\uDE22', '\uD83D\uDE31']
        },
        {
            id: 'feelings',
            label: 'How I Feel',
            icon: '\uD83D\uDCAC',
            emoji: ['\uD83D\uDE0A', '\uD83D\uDE14', '\uD83E\uDD29', '\uD83D\uDE34', '\uD83E\uDD75', '\uD83E\uDD76']
        }
    ],
    recentlyUsed: {
        enabled: true,
        maxCount: 16,
        storageKey: 'my-app-recent-emoji',
        defaultEmoji: ['\u2764\uFE0F', '\uD83D\uDE00', '\uD83D\uDC4D']
    },
    excludeCategories: ['people', 'animals', 'food', 'travel', 'activities', 'objects', 'symbols', 'flags'],
    onEmojiClick: function(emoji) {
        document.getElementById('output').textContent = emoji.unicode;
    }
});
```
