const express = require('express');
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { consultarHsp, consultarBaterias, consultarPaineis, consultarInversores, consultarInversoresCompativeis } = require('../controllers/dimensionamentoController');

const router = express.Router();

router.use(auth);
router.get('/hsp', asyncHandler(consultarHsp));
router.get('/baterias', asyncHandler(consultarBaterias));
router.get('/paineis', asyncHandler(consultarPaineis));
router.get('/inversores/compativeis', asyncHandler(consultarInversoresCompativeis));
router.get('/inversores', asyncHandler(consultarInversores));

module.exports = router;
