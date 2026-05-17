const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  // Collect console messages
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Screenshot 1: Environment step
  await page.screenshot({ path: 'screenshot-1-environment.png', fullPage: false });
  console.log('Screenshot 1: Environment step');
  
  // Click "Model Builder" nav button
  await page.locator('nav button').filter({ hasText: 'Model' }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot-2-model-start.png', fullPage: false });
  console.log('Screenshot 2: Model Builder start');
  
  // Click "Blank model" start card
  await page.locator('button.start-card').filter({ hasText: 'Blank model' }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot-3-pin-editor.png', fullPage: false });
  console.log('Screenshot 3: Pin cell editor');
  
  // Add a pin cell
  await page.locator('button').filter({ hasText: '+ Add pin cell type' }).first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshot-3b-pin-added.png', fullPage: false });
  console.log('Screenshot 3b: Pin cell added');
  
  // Click "Next: Assemblies"
  await page.locator('button').filter({ hasText: 'Next: Assemblies' }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot-4-assembly-empty.png', fullPage: false });
  console.log('Screenshot 4: Assembly editor (empty)');
  
  // Add assembly
  await page.locator('button').filter({ hasText: '+ Add assembly type' }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot-5-assembly-rect.png', fullPage: false });
  console.log('Screenshot 5: Assembly with rect lattice');
  
  // Change to hex lattice
  await page.locator('select').first().selectOption('hex');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot-6-hex-lattice.png', fullPage: false });
  console.log('Screenshot 6: Hex lattice');
  
  // Click on a hex cell to change it
  const hexCells = await page.locator('.assembly-hex-cell').all();
  if (hexCells.length > 0) {
    await hexCells[0].click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshot-6b-hex-cell-clicked.png', fullPage: false });
    console.log('Screenshot 6b: Hex cell clicked');
  }
  
  // Increase rings to 4
  await page.locator('label').filter({ hasText: 'Rings' }).locator('input').fill('4');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot-7-hex-4-rings.png', fullPage: false });
  console.log('Screenshot 7: Hex lattice with 4 rings');
  
  // Go to Core step
  await page.locator('button').filter({ hasText: 'Next: Core' }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot-8-core-empty.png', fullPage: false });
  console.log('Screenshot 8: Core editor (empty)');
  
  // Create core
  await page.locator('button').filter({ hasText: 'Create' }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot-9-core-rect.png', fullPage: false });
  console.log('Screenshot 9: Core with rect layout');
  
  // Change core to hex
  const coreSelect = page.locator('.core-card select').first();
  if (await coreSelect.count() > 0) {
    await coreSelect.selectOption('hex');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshot-10-core-hex.png', fullPage: false });
    console.log('Screenshot 10: Core with hex layout');
  }
  
  // Full page screenshot
  await page.screenshot({ path: 'screenshot-11-fullpage.png', fullPage: true });
  console.log('Screenshot 11: Full page');
  
  // Performance metrics
  const metrics = await page.metrics();
  console.log('\n=== Performance Metrics ===');
  console.log('JS Heap Used: ' + (metrics.JSHeapUsed / 1024 / 1024).toFixed(2) + ' MB');
  console.log('JS Heap Total: ' + (metrics.JSHeapTotal / 1024 / 1024).toFixed(2) + ' MB');
  console.log('Documents: ' + metrics.Documents);
  console.log('Frames: ' + metrics.Frames);
  
  // Console errors
  if (consoleErrors.length > 0) {
    console.log('\n=== Console Errors ===');
    consoleErrors.forEach(e => console.log('  ' + e));
  } else {
    console.log('\nNo console errors.');
  }
  
  // Page info
  console.log('\n=== Page Info ===');
  console.log('Title: ' + await page.title());
  console.log('URL: ' + page.url());
  
  // Check for hex cells
  const hexCellCount = await page.locator('.assembly-hex-cell').count();
  console.log('Hex cells rendered: ' + hexCellCount);
  
  // Check CSS styles of hex cells
  if (hexCellCount > 0) {
    const firstCell = page.locator('.assembly-hex-cell').first();
    const box = await firstCell.boundingBox();
    console.log('First hex cell size: ' + (box ? box.width.toFixed(1) + 'x' + box.height.toFixed(1) : 'null'));
  }
  
  console.log('\nDone!');
  await browser.close();
})();
