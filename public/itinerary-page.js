// Behaviour for the shareable itinerary page (loaded with a strict CSP,
// so this lives in an external file rather than inline).

(function () {
  var printBtn = document.getElementById('printBtn');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

  var emailBtn = document.getElementById('emailBtn');
  if (!emailBtn) return;
  var msg = document.getElementById('emailMsg');
  var id = emailBtn.getAttribute('data-id');

  emailBtn.addEventListener('click', async function () {
    emailBtn.disabled = true;
    msg.style.color = '#5b6b7c';
    msg.textContent = 'Sending…';
    try {
      var res = await fetch('/api/itinerary/' + encodeURIComponent(id) + '/email', { method: 'POST' });
      var data = await res.json().catch(function () { return {}; });
      if (res.status === 401) {
        msg.style.color = '#c0392b';
        msg.innerHTML = '⚠️ Please <a href="/login" style="color:#2f7fb8">log in</a> first to email yourself a copy.';
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Could not send the email.');
      msg.style.color = '#2a9d8f';
      msg.textContent = '✅ Sent to ' + data.emailedTo;
    } catch (e) {
      msg.style.color = '#c0392b';
      msg.textContent = '⚠️ ' + e.message;
      emailBtn.disabled = false;
    }
  });
})();
