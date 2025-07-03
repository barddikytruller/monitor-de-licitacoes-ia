// deu russo nesse aqui

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const cheerio = require('cheerio');

const URL_PETRONECT = 'https://www.petronect.com.br/irj/go/km/docs/pccshrcontent/Site%20Content%20(Legacy)/Portal2018/pt/lista_licitacoes_publicadas_ft.html';

async function buscarPetronect(filtros) {
    console.log('\n[Petronect] Iniciando busca em MODO VISUAL (HEADLESS: FALSE)...');
    let browser = null;
    try {
        browser = await puppeteer.launch({ 
            headless: false,
            slowMo: 100 
        }); 
        const page = await browser.newPage();
        
        console.log('[Petronect] Navegando para a página... OBSERVE A JANELA DO NAVEGADOR.');
        await page.goto(URL_PETRONECT, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const seletorDaTabela = '#result'; 
        console.log(`[Petronect] Aguardando o carregamento da lista inicial...`);
        await page.waitForSelector(seletorDaTabela, { timeout: 60000 });
        
        console.log('[Petronect] ✅ Lista inicial deveria estar visível agora. Extraindo HTML...');
        const html = await page.content();
        
        console.log('[Petronect] Fechando o navegador em 5 segundos...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await browser.close();

        const $ = cheerio.load(html);
        const licitacoesEncontradas = [];
        $('#result tr').each((index, element) => {
            const colunas = $(element).find('td');
            if (colunas.length > 0) {
                const numero = $(colunas[0]).text().trim();
                const objeto = $(colunas[1]).text().trim();
                const status = $(colunas[2]).text().trim();
                const empresa = $(colunas[3]).text().trim();
                licitacoesEncontradas.push({ fonte: 'Petronect', numero, objeto, status, empresa });
            }
        });

        console.log(`[Petronect] ✅ Extração concluída. ${licitacoesEncontradas.length} licitações encontradas.`);
        return licitacoesEncontradas;

    } catch (error) {
        console.error('[Petronect] ❌ Erro ao buscar no Petronect:', error.message);
        console.log('[Petronect] O navegador permanecerá aberto por 20 segundos para inspeção. Feche-o manualmente depois.');
        await new Promise(resolve => setTimeout(resolve, 20000));
        if (browser) {
            await browser.close();
        }
        return [];
    }
}

module.exports = { buscarPetronect };