import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class AgentPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'groundwork.panel';
  private _view?: vscode.WebviewView;
  private _messageHandler?: (msg: any) => void;
  private _extensionUri: vscode.Uri;
  private _textBuffer = '';
  private _batchTimer: NodeJS.Timeout | null = null;

  constructor(extensionUri: vscode.Uri, messageHandler?: (msg: any) => void) {
    this._extensionUri = extensionUri;
    this._messageHandler = messageHandler;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      if (this._messageHandler) {
        this._messageHandler(message);
      }
    });
  }

  public post(msg: any): void {
    if (msg.type === 'text') {
      this._textBuffer += msg.delta;
      if (!this._batchTimer) {
        this._batchTimer = setTimeout(() => {
          this._flushText();
        }, 40);
      }
      return;
    }

    this._flushText();
    this._view?.webview.postMessage(msg);
  }

  private _flushText(): void {
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
    if (this._textBuffer) {
      this._view?.webview.postMessage({ type: 'text', delta: this._textBuffer });
      this._textBuffer = '';
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'panel.html');
    let html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf-8') : '<h1>Groundwork</h1>';

    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.js')
    );

    html = html.replace('panel.css', cssUri.toString());
    html = html.replace('panel.js', jsUri.toString());

    return html;
  }
}
