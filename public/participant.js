'use strict';
// Se expone la conexión para que el profesor pueda enviar mensajes inválidos desde F12.
const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
window.socket = socket;
let joined = false;
let pending = 0;
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
function send(message) {
  if (socket.readyState !== WebSocket.OPEN) { showError('No hay conexión. Recargá la página para ingresar de nuevo.'); return false; }
  socket.send(JSON.stringify(message)); return true;
}
socket.addEventListener('open', () => { $('connection').textContent = 'WebSocket conectado'; $('join').disabled = false; });
socket.addEventListener('close', () => {
  $('connection').textContent = 'Conexión cerrada. Recargá la página para volver a ingresar.';
  $('join').disabled = true; $('room').hidden = true; joined = false;
});
socket.addEventListener('error', () => showError('Error de conexión WebSocket.'));
socket.addEventListener('message', event => {
  const msg = JSON.parse(event.data);
  console.log('Servidor:', msg);
  switch (msg.type) {
    case 'joined':
      joined = true; $('join-form').hidden = true; $('identity').hidden = false;
      $('identity').textContent = `Ingresaste como ${msg.name}`; $('room').hidden = false; showError(''); break;
    case 'state':
      $('count').textContent = msg.participants.length;
      $('people').textContent = msg.participants.join(', ') || '—';
      renderRanking(msg.products, (type, productId) => { showError(''); send({ type, productId }); }); break;
    case 'proposal_result': {
      pending = Math.max(0, pending - 1);
      $('propose').disabled = pending > 0;
      const result = $('result'); result.replaceChildren();
      result.append(element('p', msg.added.length ? `Agregados: ${msg.added.join(', ')}` : 'No se agregaron productos.', msg.added.length ? 'success' : 'muted'));
      for (const failure of msg.failures) result.append(element('p', `ID ${failure.id}: ${failure.message} (${failure.code})`, 'error'));
      if (pending) result.append(element('p', `Propuestas pendientes: ${pending}`, 'muted'));
      break;
    }
    case 'error': showError(`${msg.message} (${msg.code})`); break;
  }
});
$('join-form').addEventListener('submit', e => { e.preventDefault(); showError(''); send({ type: 'join', name: $('name').value }); });
$('proposal-form').addEventListener('submit', e => {
  e.preventDefault(); if (!joined || pending) return; showError('');
  const parts = $('ids').value.split(',').map(s => s.trim());
  const ids = parts.map(Number);
  if (parts.length < 1 || parts.length > 10 || parts.some(s => !/^\d+$/.test(s)) || ids.some(n => !Number.isSafeInteger(n) || n <= 0)) {
    showError('Ingresá entre 1 y 10 IDs enteros positivos, separados por coma.'); return;
  }
  if (send({ type: 'propose', ids })) {
    pending++; $('propose').disabled = true; $('result').textContent = `Consultando catálogo… (${pending} propuesta(s) pendiente(s))`; $('ids').value = '';
  }
});
