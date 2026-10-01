const express = require('express');
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { consultarHsp } = require('../controllers/dimensionamentoController');

const router = express.Router();

router.use(auth);
router.get('/hsp', asyncHandler(consultarHsp));

module.exports = router;
