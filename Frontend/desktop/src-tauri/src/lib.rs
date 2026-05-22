use tauri::LogicalSize;

// 콘솔 창을 로그인 폼에 딱 맞는 작은 화면으로 축소
#[tauri::command]
fn set_window_login(window: tauri::Window) {
    let _ = window.set_resizable(true);
    let _ = window.set_min_size(Some(LogicalSize::new(360.0, 460.0)));
    let _ = window.set_size(LogicalSize::new(360.0, 460.0));
    let _ = window.set_resizable(false);
    let _ = window.center();
}

// 콘솔 창을 대시보드용 큰 화면으로 확장
#[tauri::command]
fn set_window_main(window: tauri::Window) {
    let _ = window.set_resizable(true);
    let _ = window.set_min_size(Some(LogicalSize::new(1024.0, 720.0)));
    let _ = window.set_size(LogicalSize::new(1440.0, 900.0));
    let _ = window.center();
}

// 보고서 인쇄.
// macOS WKWebView는 window.print()를 지원하지 않으므로 NSPrintOperation을 직접 실행한다.
// 그 외(Windows WebView2 등)는 webview에서 window.print()를 평가한다.
#[tauri::command]
fn print_report(webview_window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // C 구조체(NSSize/NSRect) — paperSize 조회 및 print view frame 설정용.
        #[repr(C)]
        struct CGPoint {
            x: f64,
            y: f64,
        }
        #[repr(C)]
        struct CGSize {
            width: f64,
            height: f64,
        }
        #[repr(C)]
        struct CGRect {
            origin: CGPoint,
            size: CGSize,
        }
        webview_window
            .with_webview(|webview| unsafe {
                use objc::runtime::{Object, Sel};
                use objc::{class, msg_send, sel, sel_impl};
                let wk = webview.inner() as *mut Object;
                let info: *mut Object = msg_send![class!(NSPrintInfo), sharedPrintInfo];
                let paper: CGSize = msg_send![info, paperSize];
                let op: *mut Object = msg_send![wk, printOperationWithPrintInfo: info];
                let _: () = msg_send![op, setShowsPrintPanel: true];
                // WKWebView 빈 페이지 회피: print view의 frame을 용지 크기로 설정.
                let view: *mut Object = msg_send![op, view];
                if !view.is_null() {
                    let frame = CGRect {
                        origin: CGPoint { x: 0.0, y: 0.0 },
                        size: paper,
                    };
                    let _: () = msg_send![view, setFrame: frame];
                }
                // runOperation은 WKWebView에서 빈 출력 → runOperationModalForWindow 사용.
                let ns_window: *mut Object = msg_send![wk, window];
                let nil_sel: Sel = std::mem::transmute(0usize);
                let _: () = msg_send![op,
                    runOperationModalForWindow: ns_window
                    delegate: std::ptr::null_mut::<Object>()
                    didRunSelector: nil_sel
                    contextInfo: std::ptr::null_mut::<std::ffi::c_void>()];
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        webview_window
            .eval("window.print()")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            set_window_login,
            set_window_main,
            print_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
