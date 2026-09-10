const express = require('express');
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { criar, listar, atualizar, excluir } = require('../controllers/imovelController');
const { calcular, registrar, historico } = require('../controllers/consumoController');

const router = express.Router();

router.use(auth);
router.post('/', asyncHandler(criar));
router.get('/', asyncHandler(listar));
router.put('/:id', asyncHandler(atualizar));
router.delete('/:id', asyncHandler(excluir));
router.get('/:id/consumo', asyncHandler(calcular));
router.post('/:id/consumo', asyncHandler(registrar));
router.get('/:id/historico', asyncHandler(historico));

module.exports = router;
