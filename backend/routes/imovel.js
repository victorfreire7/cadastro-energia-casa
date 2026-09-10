const express = require('express');
const auth = require('../middlewares/auth');
const { criar, listar, atualizar, excluir } = require('../controllers/imovelController');
const { calcular, registrar, historico } = require('../controllers/consumoController');

const router = express.Router();

router.use(auth);
router.post('/', criar);
router.get('/', listar);
router.put('/:id', atualizar);
router.delete('/:id', excluir);
router.get('/:id/consumo', calcular);
router.post('/:id/consumo', registrar);
router.get('/:id/historico', historico);

module.exports = router;
