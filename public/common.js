'use strict';
const $ = id => document.getElementById(id);
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function renderRanking(products, action) {
  const root = $('ranking');
  root.replaceChildren();
  if (!products.length) { root.append(element('p', 'Todavía no hay productos propuestos.', 'muted')); return; }
  products.forEach((product, i) => {
    const card = element('article', undefined, 'product');
    card.append(element('span', `#${i + 1}`, 'position'));
    const img = element('img'); img.src = product.image; img.alt = product.title; img.loading = 'lazy';
    card.append(img);
    const info = element('div', undefined, 'info');
    info.append(element('h3', product.title), element('p', `ID ${product.id} · US$ ${product.price.toFixed(2)}`), element('p', `Propuesto por ${product.proposedBy}`, 'muted'));
    card.append(info, element('strong', `${product.votes} ${product.votes === 1 ? 'voto' : 'votos'}`, 'votes'));
    if (action) {
      const buttons = element('div', undefined, 'actions');
      const vote = element('button', product.votedByMe ? 'Retirar voto' : 'Votar');
      vote.type = 'button'; vote.onclick = () => action(product.votedByMe ? 'unvote' : 'vote', product.id);
      const remove = element('button', 'Quitar', 'secondary'); remove.type = 'button';
      remove.onclick = () => action('remove', product.id);
      buttons.append(vote, remove); card.append(buttons);
    }
    root.append(card);
  });
}
