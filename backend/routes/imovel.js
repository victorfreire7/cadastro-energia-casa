const express = require('express');
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { criar, listar, atualizar, excluir } = require('../controllers/imovelController');
const { calcular, registrar, historico } = require('../controllers/consumoController');
const dimensionamento = require('../controllers/dimensionamentoController');

const router = express.Router();

router.use(auth);
router.post('/', asyncHandler(criar));
router.get('/', asyncHandler(listar));
router.put('/:id', asyncHandler(atualizar));
router.delete('/:id', asyncHandler(excluir));
router.get('/:id/consumo', asyncHandler(calcular));
router.post('/:id/consumo', asyncHandler(registrar));
router.get('/:id/historico', asyncHandler(historico));

// Dimensionamento fotovoltaico (PB01–PB04)
router.get('/:id/dimensionamento/referencia', asyncHandler(dimensionamento.referencia));
router.post('/:id/cenarios', asyncHandler(dimensionamento.criar));
router.get('/:id/cenarios/:cenarioId', asyncHandler(dimensionamento.obter));
router.put('/:id/cenarios/:cenarioId', asyncHandler(dimensionamento.atualizar));
router.get('/:id/cenarios/:cenarioId/logs', asyncHandler(dimensionamento.logs));

module.exports = router;
