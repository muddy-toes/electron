
let promode = false;

function loadPromode() {
    $(document).on('promode-on', promodeOn);
    $(document).on('promode-off', promodeOff);

    const savedPromode = getPromodeCookie();
    if (savedPromode) {
        if (savedPromode === 'true') {
            $(document).trigger('promode-on');
        } else {
            $(document).trigger('promode-off');
        }
    }
}

function promodeOn(setcookie=true) {
    promode = false;
    togglePromode(setcookie);
}

function promodeOff(setcookie=true) {
    promode = true;
    togglePromode();
}

function togglePromode(setcookie=true) {
    if (promode) {
        promode = false;
        $('body .promode').hide();
        $('body').removeClass('promode').addClass('classicmode');
        $('body .classicmode').slideDown();
        if (setcookie) setPromodeCookie("false", 30); // Save the user's choice in a cookie
    } else {
        promode = true;
        $('body .classicmode').hide();
        $('body').removeClass('classicmode').addClass('promode');
        $('body .promode').slideDown();
        if (setcookie) setPromodeCookie("true", 30); // Save the user's choice in a cookie
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

