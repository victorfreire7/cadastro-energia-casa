const { montarProposta, renderizarHtml } = require('../services/proposta');

// POST /dimensionamento/proposta            -> JSON consolidado
// POST /dimensionamento/proposta?formato=html -> relatório HTML
async function gerar(req, res) {
  const proposta = montarProposta(req.body);
  if (proposta.erros) {
    return res.status(400).json({
      message: 'não foi possível gerar a proposta: ' + proposta.erros[0],
      erros: proposta.erros
    });
  }
  if (req.query && req.query.formato === 'html') {
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderizarHtml(proposta));
  }
  res.json(proposta);
}

module.exports = { gerar };
