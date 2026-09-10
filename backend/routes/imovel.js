const express = require('express');
const auth = require('../middlewares/auth');
const { criar, listar, atualizar, excluir } = require('../controllers/imovelController');

const router = express.Router();

router.use(auth);
router.post('/', criar);
router.get('/', listar);
router.put('/:id', atualizar);
router.delete('/:id', excluir);

module.exports = router;
