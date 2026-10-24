const { compararCenarios } = require('../services/comparacao');

// POST /dimensionamento/comparacao
// Corpo: { semBaterias: {...}, comBaterias: {...} } (formato em services/comparacao.js)
async function comparar(req, res) {
  const { semBaterias, comBaterias } = req.body || {};
  const resultado = compararCenarios({ semBaterias, comBaterias });
  if (resultado.erros) {
    return res.status(400).json({
      message: 'não foi possível comparar os cenários: ' + resultado.erros[0],
      erros: resultado.erros
    });
  }
  res.json(resultado);
}

module.exports = { comparar };
