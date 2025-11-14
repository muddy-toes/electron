
let promode = false;

function loadPromode() {
    const savedPromode = getPromodeCookie();
    if (savedPromode) {
        togglePromode(savedPromode);
    }
}

function togglePromode(forcemode=null) {
    if (forcemode === false || (forcemode === null && promode === true)) {
        promode = false;
        $('.promode').slideUp();
        setPromodeCookie("false", 30); // Save the user's choice in a cookie
        $(document).trigger('promode-off');
    } else if(forcemode === true || (forcemode === null && promode === false)) {
        promode = true;
        $('.promode').slideDown();
        setPromodeCookie("true", 30); // Save the user's choice in a cookie
        $(document).trigger('promode-on');
    }
}

function setPromodeCookie(value, days) {
    const name = "promode";
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
}

function getPromodeCookie() {
    const name = "promode";
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

