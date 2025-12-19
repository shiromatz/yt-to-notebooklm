const CONFIG = {
    URLS: {
        NOTEBOOKLM_BASE: "https://notebooklm.google.com/",
        NOTEBOOKLM_MATCH: "https://notebooklm.google.com/*",
        YOUTUBE_HOME: "https://www.youtube.com/",
        YOUTUBE_HOMEPAGE_QUERY: "https://www.youtube.com/?",
        YOUTUBE_WATCH_BASE: "https://www.youtube.com/watch?v=",
        YOUTUBE_PLAYLIST_MARKERS: ["list=", "playlist", "/videos", "/feed/", "/results", "/hashtag/"],
        YOUTUBE_DOMAINS: ["www.youtube.com", "youtube.com"]
    },
    DEBUG_MODE: false,
    SELECTORS: {
        YOUTUBE: {
            PLAYLIST_LINKS: [
                "a#video-title",
                "a#video-title-link",
                "a.yt-lockup-metadata-view-model__title"
            ]
        },
        NOTEBOOKLM: {
            CREATE_BUTTONS: [
                ".create-new-button",
                ".create-new-action-button",
                "button[aria-label='Create new notebook']"
            ],
            ADD_SOURCE_BTNS: [
                "button[aria-label='Add source']",
                "button[aria-label='ソースを追加']"
            ],
            DIALOG: "mat-dialog-container, [role='dialog']",
            ICONS: ".mat-icon, .material-icons, i",
            INPUT: "input[formcontrolname='newUrl']",
            LIMIT_COUNTER: ".postfix",
            YOUTUBE_CHIP: "mat-chip",
            CHIP_LABEL: ".mat-mdc-chip-action-label",
            CLOSE_BTNS: "button[aria-label='Close'], button.close-button",
            BACKDROP: ".cdk-overlay-backdrop"
        }
    },
    MESSAGES: {
        PING: "PING",
        SEND_URL: "SEND_URL_TO_NOTEBOOKLM",
        PROCESS_PLAYLIST: "PROCESS_PLAYLIST",
        ADD_SOURCE: "ADD_SOURCE_URL",
        CLOSE_DIALOG: "CLOSE_DIALOG"
    },
    COLORS: {
        ERROR: "#b00020",
        SUCCESS: "#0a7d26",
        PROGRESS: "#005a9c",
        DEFAULT: "#000000"
    },
    TIMEOUTS: {
        AUTO_ADD_MAX: 9000,
        POLL_INTERVAL: 200,
        UI_CLICK_DELAY: 50,
        UI_ANIMATION_SHORT: 200,
        UI_ANIMATION_MED: 500,
        UI_ANIMATION_LONG: 2500,
        UI_VALIDATION_WAIT: 800,
        UI_INPUT_DEBOUNCE: 100,
        DIALOG_WAIT: 3000,
        ELEMENT_WAIT: 2000,
        VERIFY_POLL_MAX: 10000,
        REDIRECT_WAIT: 15000,
        BADGE_DISPLAY: 3000,
        BADGE_DISPLAY_LONG: 5000,
        BATCH_ITEM_DELAY: 500,
        POPUP_CLOSE_LONG: 1500,
        POPUP_CLOSE_SHORT: 800,
        POLL_FAST: 100,
        POLL_MED: 500,
        CREATE_NOTEBOOK_WAIT: 10000
    },
    TEXTS: {
        ADD_SOURCE_BUTTONS: [
            "Add source", "ソースを追加", "Ajouter une source", "Añadir fuente", "Aggiungi fonte", "소스 추가", "添加来源", "إضافة مصدر"
        ],
        YOUTUBE_CHIPS: ["youtube"],
        SUBMIT_BUTTONS: [
            "insert", "add", "追加", "挿入", "insérer", "ajouter", "insertar", "añadir", "inserisci", "aggiungi", "삽입", "추가", "插入", "添加", "إدراج", "إضافة"
        ],
        SUCCESS_TOASTS: [
            "added to notebook", "ソースを追加しました", "ajouté", "source", "añadido", "fuente", "aggiunto", "fonte", "추가됨", "추가되었습니다", "已添加", "来源", "تم", "إضافة"
        ],
        ERROR_DIALOGS: [
            "invalid url", "無効なurl", "can't add", "追加できません", "non valide", "impossible", "inválida", "no se puede", "non valido", "impossibile", "잘못된", "할 수 없음", "无效", "无法", "غير صالح", "تعذر"
        ],
        INPUT_KEYWORDS: ["youtube", "url", "link"]
    }
};
