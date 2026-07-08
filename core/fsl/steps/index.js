// core/fsl/steps/index.js
//
// Exporta os 8 steps na ordem de execução.
// O runner importa só isto, não conhece cada arquivo individualmente.

module.exports = [
  require('./login'),
  require('./buscarSA'),
  require('./anteciparStatus'),
  require('./concluirStatus'),
  require('./consumoEquipamentos'),
  require('./consumoMateriais'),
  require('./verSenha'),
  require('./encerramento'),
];
