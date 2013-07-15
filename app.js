#!/usr/bin/env gjs
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;

/*
 * Connect to server
 ************************/
let sockCl = new Gio.SocketClient({tls: true});
let sockCon = sockCl.connect_to_host("10bit.danopia.net", 10817, null);
let outStr = sockCon.get_output_stream();
let inStr = sockCon.get_input_stream();

function readHandler (stream, result) {
  let bytes = stream.read_bytes_finish(result, null);
  stream.read_bytes_async(1024*5, 0, null, readHandler);
  
  let data = String(bytes.unref_to_array()).trim();
  let pkt = JSON.parse(data);
  
  if (pkt.op == 'welcome') {
    showAuth(pkt.ex.server, pkt.ex.auth[0]);
  } else if (pkt.op == 'ack') {
    addLine('Authenticated to server');
  } else if (pkt.op == 'act') {
    addLine('<' + pkt.sr + '> ' + pkt.ex.data);
  } else {
    print('unhandled op ' + pkt.op);
  };
  
}
inStr.read_bytes_async(1024*5, 0, null, readHandler);

/*
 * Dialogs
 ************************/
function showAuth (server, method) {
  let window = new Gtk.Dialog({title: "Log in to " + server, modal: true});
  window.set_transient_for(rootWin);
  window.set_destroy_with_parent(true);
  window.add_button('gtk-connect', Gtk.ResponseType.ACCEPT).grab_default();
  window.add_button('gtk-cancel', Gtk.ResponseType.REJECT);

  let grid = new Gtk.Grid ({row_spacing: 10, column_spacing: 10, margin: 5});

  let userText, passTxt;
  grid.attach(new Gtk.Label({label: 'Username'}), 0, 0, 1, 1);
  grid.attach(userTxt = new Gtk.Entry({activates_default: true}), 1, 0, 1, 1);
  grid.attach(new Gtk.Label({label: 'Password'}), 0, 1, 1, 1);
  grid.attach(passTxt = new Gtk.Entry({activates_default: true, input_purpose: Gtk.InputPurpose.PASSWORD, visibility: false}), 1, 1, 1, 1);

  window.get_content_area().add(grid);
  window.show_all();
  
  let response;
  while ((response = window.run()) == Gtk.ResponseType.ACCEPT) {
    let user, pass;
    if ((user = userTxt.get_text()).length == 0) continue;
    if ((pass = passTxt.get_text()).length == 0) continue;
    
    outStr.write(JSON.stringify({op: 'auth', ex: {username: user, password: pass, method: 'password'}}) + '\n', null);
    break;
  };
  
  window.destroy();
}

function addLine (line) {
  let doc = webView.get_dom_document();
  let p = doc.create_element('p');
  p.inner_text = line;
  doc.get_element_by_id('backlog').append_child(p);
  p.scroll_into_view(false);
}

function dialog (message) {
  let msg = new Gtk.MessageDialog({text: message});
  msg.set_transient_for(rootWin);
  msg.set_destroy_with_parent(true);
  msg.add_button('gtk-ok', Gtk.ResponseType.ACCEPT).grab_default();
  msg.run();
  msg.destroy();
}


/*
 * Run the main thang
 ************************/
Gtk.init(null, 0);

var rootWin = new Gtk.Window({type: Gtk.WindowType.TOPLEVEL, border_width: 10});
rootWin.title = "10Gbit";
rootWin.set_default_size(800, 600);
rootWin.connect("destroy", function () { Gtk.main_quit(); });

let webView = new imports.gi.WebKit.WebView();
webView.connect('close-web-view', function () { Gtk.main_quit(); });
webView.load_string("<section id='backlog'></section>", 'text/html', 'utf-8', 'about:blank');

let scroller = new Gtk.ScrolledWindow();
scroller.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC);
scroller.add(webView);

let msgTxt = new Gtk.Entry({activates_default: true});
let msgBtn = new Gtk.Button({label: 'Send', can_default: true});
let msgBox = new Gtk.HBox();
msgBox.pack_start(msgTxt, true, true, 0);
msgBox.pack_end(msgBtn, false, false, 0);

msgBtn.connect('clicked', function () {
  let msg = msgTxt.get_text();
  outStr.write(JSON.stringify({op: 'act', rm: '48557f95', ex: {type: 'msg', data: msg}}) + '\n', null);
  msgTxt.set_text('');
});

let rootBox = new Gtk.VBox();
rootBox.pack_start(scroller, true, true, 5);
rootBox.pack_end(msgBox, false, false, 0);

rootWin.add(rootBox);
rootWin.show_all();

msgTxt.grab_focus();
msgBtn.grab_default();

Gtk.main();

outStr.write(JSON.stringify({op: 'leave'}) + '\n', null);

