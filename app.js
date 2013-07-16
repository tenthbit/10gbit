#!/usr/bin/env gjs
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Notify = imports.gi.Notify;

let rooms = {};

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
  } else if (pkt.op == 'auth') {
    //addLine('Authenticated as ' + pkt.ex.username);
  } else if (pkt.op == 'act') {
    if (pkt.ex.message) {
      if (pkt.ex.isaction) {
        addLine(pkt.rm, '* ' + pkt.sr + ' ' + pkt.ex.message, pkt.ts);
      } else {
        addLine(pkt.rm, '<' + pkt.sr + '> ' + pkt.ex.message, pkt.ts);
      }
      
      if (!pkt.ex.isack && !rootWin.is_active) {
        let notif = new Notify.Notification({summary: pkt.sr + ' messaged '+rooms[pkt.rm].name, body: pkt.ex.message});
        notif.show();
      };
    };
  } else if (pkt.op == 'join') {
    addLine(pkt.rm, pkt.sr + ' joined', pkt.ts);
    
    let tab = getTab(pkt.rm);
    let iter = tab.userstore.append();
    tab.userstore.set_value(iter, 0, pkt.sr);
    tab.room.users.push(pkt.sr);
  } else if (pkt.op == 'leave') {
    if (pkt.rm) {
      if (pkt.ex && pkt.ex.isack && pkt.ex.closeTab) {
        let tab = getTab(pkt.rm);
        notebook.remove_page(tab.idx);
        
        for (let id in tabs) {
          if (tabs[id].idx > tab.idx)
            tabs[id].idx--;
        };
        
        delete tabs[pkt.rm];
      } else {
        addLine(pkt.rm, pkt.sr + ' left', pkt.ts);
      
        let tab = getTab(pkt.rm);
        tab.room.users.splice(tab.room.users.indexOf(pkt.sr), 1);
        tab.updateUserlist();
      }
    } else {
      for (id in tabs) {
        let tab = tabs[id], idx;
        if ((idx = tab.room.users.indexOf(pkt.sr)) == -1) continue;
        
        addLine(id, pkt.sr + ' disconnected', pkt.ts);
        tab.room.users.splice(idx, 1);
        tab.updateUserlist();
      };
      // TODO: everything
    }
  } else if (pkt.op == 'meta' && pkt.rm) {
    rooms[pkt.rm] = pkt.ex;
    
    let tab = getTab(pkt.rm);
    tab.updateUserlist();
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

function addLine (id, line, ts) {
  let tab = getTab(id);
  if (!tab) return false;
  
  if (tab.ready) {
    if (ts)
      line = '[' + (new Date(ts).toLocaleFormat('%H:%M:%S')) + '] ' + line;
    
    let doc = getTab(id).webView.get_dom_document();
    let p = doc.create_element('p');
    p.inner_text = line;
    doc.get_element_by_id('backlog').append_child(p);
    p.scroll_into_view(false);
  } else {
    tab.backlog.push([line, ts]);
  };
  return true;
}

function flush_lines (id) {
  let tab = getTab(id);
  if (!tab || tab.ready) return false;
  tab.ready = true;
  
  tab.backlog.forEach(function (args) {
    addLine(id, args[0], args[1]);
  });
  delete tab.backlog;
  return true;
}

function currentRoom () {
  let idx = notebook.get_current_page();
  for (id in tabs) {
    if (tabs[id].idx == idx)
      return id;
  };
  return null;
}


function dialog (message) {
  let msg = new Gtk.MessageDialog({text: message});
  msg.set_transient_for(rootWin);
  msg.set_destroy_with_parent(true);
  msg.add_button('gtk-ok', Gtk.ResponseType.ACCEPT).grab_default();
  msg.run();
  msg.destroy();
}


// close tab buttons
function TabLabel (text) {
  this.box = new Gtk.Box();

  this.box.set_orientation(Gtk.Orientation.HORIZONTAL);
  this.box.set_spacing(5); // spacing: [icon|5px|label|5px|close]  
  
  // icon
  //this.icon = Gtk.Image.new_from_stock(Gtk.STOCK_FILE, Gtk.IconSize.MENU);
  //this.box.pack_start(this.icon, false, false, 0);
  
  // label 
  this.label = new Gtk.Label({label: text});
  this.box.pack_start(this.label, true, true, 0);
  
  // close button
  this.button = new Gtk.Button({focus_on_click: false});
  this.button.set_relief(Gtk.ReliefStyle.NONE);
  this.button.add(Gtk.Image.new_from_stock(Gtk.STOCK_CLOSE, Gtk.IconSize.MENU));
  //this.button.connect("clicked", self.button_clicked);
  this.data = ".button {\n" +
          "-GtkButton-default-border : 0px;\n" +
          "-GtkButton-default-outside-border : 0px;\n" +
          "-GtkButton-inner-border: 0px;\n" +
          "-GtkWidget-focus-line-width : 0px;\n" +
          "-GtkWidget-focus-padding : 0px;\n" +
          "padding: 0px;\n" +
          "}";
  this.provider = new Gtk.CssProvider();
  this.provider.load_from_data(this.data);
  // 600 = GTK_STYLE_PROVIDER_PRIORITY_APPLICATION
  this.button.get_style_context().add_provider(this.provider, 600);
  this.box.pack_start(this.button, false, false, 0);
  
  this.box.show_all();
};


/*
 * Run the main thang
 ************************/
Gtk.init(null, 0);
Notify.init("10Gbit");

var rootWin = new Gtk.Window({type: Gtk.WindowType.TOPLEVEL, border_width: 10});
rootWin.title = "10Gbit";
rootWin.set_default_size(800, 600);
rootWin.connect("destroy", function () { Gtk.main_quit(); });

let tabs = {};
function getTab (id) {
  if (id in tabs)
    return tabs[id];
  
  let tab = {backlog: []};
  tab.room = rooms[id];
  if (!tab.room) {print('bad');return null;}
  
  tab.webView = new imports.gi.WebKit.WebView();
  tab.webView.connect('close-web-view', function () { Gtk.main_quit(); });
  tab.webView.connect('load-finished', function () { flush_lines(id); });
  tab.webView.load_string("<style>p { font-size: 10pt; margin: 6px 0; padding-left: 50px; text-indent: -50px; }</style><section id='backlog'></section>", 'text/html', 'utf-8', 'file:///');
  //
  tab.scroller = new Gtk.ScrolledWindow();
  tab.scroller.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.ALWAYS);
  tab.scroller.add(tab.webView);
  
  tab.userlist = new Gtk.TreeView({headers_visible: false});
  tab.userstore = new Gtk.ListStore();
  tab.userstore.set_column_types([imports.gi.GObject.TYPE_STRING]);
  tab.userlist.set_model(tab.userstore);
  tab.userlist.get_selection().set_mode(Gtk.SelectionMode.MULTIPLE);
  //
  tab.usercolumn = new Gtk.TreeViewColumn();
  tab.usercell = new Gtk.CellRendererText();
  tab.usercell.set_fixed_size(100, -1);
  tab.usercolumn.pack_start(tab.usercell, true);
  tab.usercolumn.add_attribute(tab.usercell, "text", 0);
  tab.userlist.append_column(tab.usercolumn);
  //
  tab.scroller2 = new Gtk.ScrolledWindow();
  tab.scroller2.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
  tab.scroller2.add(tab.userlist);
  
  tab.box = new Gtk.HBox();
  tab.box.pack_start(tab.scroller, true, true, 0);
  tab.box.pack_start(tab.scroller2, false, false, 0);
  
  tab.label = new TabLabel(tab.room.name);
  tab.idx = notebook.append_page(tab.box, tab.label.box);
  notebook.show_all();
  
  tab.label.button.connect('clicked', function () {
    outStr.write(JSON.stringify({op: 'leave', rm: id, ex: {closeTab: true}}) + '\n', null);
  });
  
  tab.updateUserlist = function () {
    tab.userstore.clear();
    tab.room.users.forEach(function (user) {
      let iter = tab.userstore.append();
      tab.userstore.set_value(iter, 0, user);
    });
  };
  
  completion.set_model(tab.userstore);
  completion.set_text_column(0);
  
  return tabs[id] = tab;
};

let msgTxt = new Gtk.Entry({activates_default: true});
let msgBtn = new Gtk.Button({label: 'Send', can_default: true});
let msgBox = new Gtk.HBox();
msgBox.pack_start(msgTxt, true, true, 0);
msgBox.pack_start(msgBtn, false, false, 5);

let completion = new Gtk.EntryCompletion({inline_completion: true, popup_single_match: false});
msgTxt.set_completion(completion);
//completion.insert_action_text(0, 'Query...');
completion.connect('match-selected', function (completion, model, iter) {
  //print('asdf ' + iter);
});
completion.connect('insert-prefix', function (completion, prefix) {
  let len = msgTxt.get_text_length();
  if (prefix.length) prefix += ': ';
  msgTxt.set_text(prefix);
  msgTxt.select_region(len, prefix.length);
  return true;
});

msgBtn.connect('clicked', function () {
  let msg = msgTxt.get_text();
  msgTxt.set_text('');
  
  if (msg[0] == '/') {
    var words = msg.split(' ');
    var cmd = words.shift().substring(1);
    msg = words.join(' ');
    
    if (cmd == 'me') {
      outStr.write(JSON.stringify({op: 'act', rm: currentRoom(), ex: {message: msg, isaction: true}}) + '\n', null);
    } else if (cmd == 'join') {
      if (!msg.length) msg = currentRoom();
      outStr.write(JSON.stringify({op: 'join', rm: msg}) + '\n', null);
    } else if (cmd == 'part' || cmd == 'leave') {
      if (!msg.length) msg = currentRoom();
      outStr.write(JSON.stringify({op: 'leave', rm: msg}) + '\n', null);
    } else if (cmd == 'cycle') {
      if (!msg.length) msg = currentRoom();
      outStr.write(JSON.stringify({op: 'leave', rm: msg}) + '\n', null);
      outStr.write(JSON.stringify({op: 'join', rm: msg}) + '\n', null);
    } else if (cmd == 'quit') {
      Gtk.main_quit();
    } else {
      addLine(currentRoom(), 'Unknown command: ' + cmd);
    };
  } else {
    outStr.write(JSON.stringify({op: 'act', rm: currentRoom(), ex: {message: msg}}) + '\n', null);
  };
});

let notebook = new Gtk.Notebook();

let rootBox = new Gtk.VBox();
rootBox.pack_start(notebook, true, true, 5);
rootBox.pack_end(msgBox, false, false, 0);

rootWin.add(rootBox);
rootWin.show_all();

msgTxt.grab_focus();
msgBtn.grab_default();

Gtk.main();

outStr.write(JSON.stringify({op: 'leave'}) + '\n', null);

