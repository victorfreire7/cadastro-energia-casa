const express = require('express');
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { criar, listar, atualizar, excluir } = require('../controllers/imovelController');
const { calcular, registrar, historico } = require('../controllers/consumoController');
const dimensionamento = require('../controllers/dimensionamentoController');
const projeto = require('../controllers/projetoController');

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

// Projeto fotovoltaico completo (Sprint 3: PB18–PB21)
router.get('/:id/projetos/contexto', asyncHandler(projeto.obterContexto));
router.post('/:id/projetos/pre-dimensionamento', asyncHandler(projeto.predimensionar));
router.post('/:id/projetos/calcular', asyncHandler(projeto.calcular));
router.post('/:id/projetos', asyncHandler(projeto.salvar));
router.get('/:id/projetos', asyncHandler(projeto.listar));
router.get('/:id/projetos/:projetoId', asyncHandler(projeto.obter));
router.get('/:id/projetos/:projetoId/proposta', asyncHandler(projeto.proposta));
router.delete('/:id/projetos/:projetoId', asyncHandler(projeto.excluir));

module.exports = router;
