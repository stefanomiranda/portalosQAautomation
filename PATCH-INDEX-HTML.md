# Patch no index.html — adicionar card "Instalar via FSL"

Cole o bloco abaixo **logo depois do card "Automação de Smoke Test"** (último `</a>` do grupo `home-options`).

```html
            <a class="home-option-card" id="linkFSL" href="fsl.html?ambiente=TRG">
                <div class="card-icon">🛠️</div>
                <div class="card-body">
                    <h2>Instalar via FSL</h2>
                    <p>Conclusão automatizada da instalação no FSL (com leitura de código 2FA por email).</p>
                </div>
            </a>
```

E na função `onAmbienteChange()` do `<script>` no fim do body, **adicione esta linha**:

```js
            document.getElementById('linkFSL').href = `fsl.html?ambiente=${amb}`;
```

Resultado: o card aparece no portal, e o seletor de ambiente passa a atualizar também o link "Instalar via FSL".
