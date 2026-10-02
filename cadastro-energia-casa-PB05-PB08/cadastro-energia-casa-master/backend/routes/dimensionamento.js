const express = require('express');
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { consultarHsp, consultarPaineis, consultarPainel, consultarModulos } = require('../controllers/dimensionamentoController');

const router = express.Router();

router.use(auth);
router.get('/hsp', asyncHandler(consultarHsp));
router.get('/paineis', asyncHandler(consultarPaineis));
router.get('/paineis/:id', asyncHandler(consultarPainel));
router.get('/modulos', asyncHandler(consultarModulos));

module.exports = router;
