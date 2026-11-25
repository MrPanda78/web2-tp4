'use strict';
const events = new EventSource('/events');
events.addEventListener('open', () => { $('connection').textContent = 'SSE conectado · actualización en vivo'; });
events.addEventListener('error', () => { $('connection').textContent = 'Conexión SSE interrumpida'; });
events.addEventListener('ranking', event => {
  const msg = JSON.parse(event.data);
  $('count').textContent = msg.participantCount;
  renderRanking(msg.products);
});
