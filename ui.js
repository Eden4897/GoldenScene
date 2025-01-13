const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

// Create the main window
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.maximize();
  win.loadFile('index.html');
  
  // Create required directories if they don't exist
  const dirs = ['mcl-input', 'broadway-input', 'temp-output'];
  dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath);
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle file selection
ipcMain.handle('select-files', async (event, type) => {
  const extensions = type === 'mcl' ? ['pdf'] : ['xlsx', 'xls'];
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: type === 'mcl' ? 'PDF Files' : 'Excel Files', extensions: extensions }
    ]
  });
  
  if (!result.canceled) {
    // Clear the input directory
    const inputDir = path.join(__dirname, `${type}-input`);
    fs.readdirSync(inputDir).forEach(file => {
      fs.unlinkSync(path.join(inputDir, file));
    });
    
    // Copy selected files to input directory
    result.filePaths.forEach(filePath => {
      const fileName = path.basename(filePath);
      fs.copyFileSync(filePath, path.join(inputDir, fileName));
    });
    
    return {
      success: true,
      files: result.filePaths.map(p => path.basename(p))
    };
  }
  return { success: false };
});

// Handle file removal
ipcMain.handle('remove-file', async (event, type, filename) => {
  const inputDir = path.join(__dirname, `${type}-input`);
  const filePath = path.join(inputDir, filename);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Return list of remaining files
    const remainingFiles = fs.readdirSync(inputDir);
    return {
      success: true,
      files: remainingFiles
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Handle remove all files
ipcMain.handle('remove-all-files', async (event, type) => {
  const inputDir = path.join(__dirname, `${type}-input`);
  
  try {
    fs.readdirSync(inputDir).forEach(file => {
      fs.unlinkSync(path.join(inputDir, file));
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Handle script execution
ipcMain.on('run-script', (event, scriptType) => {
  const scriptPath = path.join(__dirname, `${scriptType}.js`);
  const inputDir = path.join(__dirname, `${scriptType}-input`);
  const tempOutputDir = path.join(__dirname, 'temp-output');
  
  // Clean any previous output files
  fs.readdirSync(tempOutputDir).forEach(file => {
    fs.unlinkSync(path.join(tempOutputDir, file));
  });
  
  exec(`node "${scriptPath}"`, async (error, stdout, stderr) => {
    if (error) {
      event.reply('script-output', {
        success: false,
        output: error.message,
        hasOutput: false
      });
      return;
    }
    
    // Check if output file exists
    const outputPath = path.join(__dirname, 'output.xlsx');
    const hasOutput = fs.existsSync(outputPath);
    
    if (hasOutput) {
      try {
        // Count input files
        const fileCount = fs.readdirSync(inputDir).length;
        
        // Generate new filename with timestamp and details
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const newFileName = `${scriptType.toUpperCase()}_${fileCount}sheets_${timestamp}.xlsx`;
        const newPath = path.join(tempOutputDir, newFileName);
        
        // Move the file to temp directory
        fs.renameSync(outputPath, newPath);
        
        event.reply('script-output', {
          success: true,
          output: stdout || 'Process completed successfully!',
          hasOutput: true,
          outputFileName: newFileName
        });
      } catch (error) {
        event.reply('script-output', {
          success: false,
          output: `Error processing output file: ${error.message}`,
          hasOutput: false
        });
      }
    } else {
      event.reply('script-output', {
        success: true,
        output: stdout || 'Process completed successfully!',
        hasOutput: false
      });
    }
  });
});

// Handle save file dialog
ipcMain.handle('save-output', async (event, outputFileName) => {
  const tempOutputPath = path.join(__dirname, 'temp-output', outputFileName);
  if (!fs.existsSync(tempOutputPath)) {
    return { success: false, error: 'Output file not found' };
  }

  const result = await dialog.showSaveDialog({
    defaultPath: outputFileName,
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
  });

  if (!result.canceled && result.filePath) {
    try {
      // Copy file to user's chosen location
      fs.copyFileSync(tempOutputPath, result.filePath);
      
      // Delete the temporary file
      fs.unlinkSync(tempOutputPath);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  return { success: false };
});

// Clean up temp files when app closes
app.on('before-quit', () => {
  const tempOutputDir = path.join(__dirname, 'temp-output');
  if (fs.existsSync(tempOutputDir)) {
    fs.readdirSync(tempOutputDir).forEach(file => {
      try {
        fs.unlinkSync(path.join(tempOutputDir, file));
      } catch (error) {
        console.error('Error cleaning up temp file:', error);
      }
    });
  }
}); 