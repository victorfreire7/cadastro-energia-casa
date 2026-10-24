const express = require('express');
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { consultarHsp } = require('../controllers/dimensionamentoController');
const { comparar } = require('../controllers/comparacaoController');
const { estimar } = require('../controllers/economiaController');
const { calcular } = require('../controllers/paybackController');
const { gerar } = require('../controllers/propostaController');

const router = express.Router();

router.use(auth);
router.get('/hsp', asyncHandler(consultarHsp));
// PB14 — comparação dos cenários sem e com baterias
router.post('/comparacao', asyncHandler(comparar));
// PB15 — estimativa de economia
router.post('/economia', asyncHandler(estimar));
// PB16 — payback simples
router.post('/payback', asyncHandler(calcular));
// PB17 — proposta consolidada (JSON ou ?formato=html)
router.post('/proposta', asyncHandler(gerar));

module.exports = router;
