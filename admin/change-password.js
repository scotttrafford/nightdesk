/* change-password.js */

function toggle(id, met) {
    document.getElementById(id).classList.toggle('met', met);
}

function checkStrength(val) {
    toggle('req-length',  val.length >= 12);
    toggle('req-upper',   /[A-Z]/.test(val));
    toggle('req-lower',   /[a-z]/.test(val));
    toggle('req-number',  /[0-9]/.test(val));
    toggle('req-special', /[!@#$%^&*\-_+=?]/.test(val));
}

document.getElementById('new_password').addEventListener('input', function () {
    checkStrength(this.value);
});
