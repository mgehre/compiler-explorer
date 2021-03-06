// Copyright (c) 2016, Matt Godbolt
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

"use strict";

var _ = require('underscore');
var $ = require('jquery');
var FontScale = require('../fontscale');
var AnsiToHtml = require('../ansi-to-html');
var Toggles = require('../toggles');
var ga = require('../analytics');

function makeAnsiToHtml(color) {
    return new AnsiToHtml({
        fg: color ? color : '#333',
        bg: '#f5f5f5',
        stream: true,
        escapeXML: true
    });
}

function Output(hub, container, state) {
    this.container = container;
    this.compilerId = state.compiler;
    this.editorId = state.editor;
    this.eventHub = hub.createEventHub();
    this.domRoot = container.getElement();
    this.domRoot.html($('#compiler-output').html());
    this.contentRoot = this.domRoot.find('.content');
    this.optionsToolbar = this.domRoot.find('.options-toolbar');
    this.compilerName = "";
    this.fontScale = new FontScale(this.domRoot, state, ".content");
    this.fontScale.on('change', _.bind(function () {
        this.saveState();
    }, this));
    this.normalAnsiToHtml = makeAnsiToHtml();
    this.errorAnsiToHtml = makeAnsiToHtml('red');

    this.initButtons();
    this.options = new Toggles(this.domRoot.find('.options'), state);
    this.options.on('change', _.bind(this.onOptionsChange, this));

    this.container.on('resize', this.resize, this);
    this.container.on('shown', this.resize, this);
    this.container.on('destroy', this.close, this);

    this.eventHub.on('compileResult', this.onCompileResult, this);
    this.eventHub.on('compilerClose', this.onCompilerClose, this);
    this.eventHub.emit('outputOpened', this.compilerId);

    this.onOptionsChange();
    this.updateCompilerName();
    ga.proxy('send', {
        hitType: 'event',
        eventCategory: 'OpenViewPane',
        eventAction: 'Output'
    });
}

Output.prototype.getEffectiveOptions = function () {
    return this.options.get();
};

Output.prototype.resize = function () {
    this.contentRoot.height(this.domRoot.height() - this.optionsToolbar.height() - 5);
};

Output.prototype.onOptionsChange = function () {
    var options = this.getEffectiveOptions();
    //this.contentRoot.css('white-space', options.wrap ? 'initial' : 'nowrap');
    //this.contentRoot.css('overflow-x', options.wrap ? 'initial' : 'auto');
    this.contentRoot.toggleClass('wrap', options.wrap);
    //this.contentRoot.toggleClass('scroll', !options.wrap);
    this.wrapButton.prop('title', '[' + (options.wrap ? 'ON' : 'OFF') + '] ' + this.wrapTitle);

    this.saveState();
};

Output.prototype.initButtons = function () {
    this.wrapButton = this.domRoot.find('.wrap-lines');
    this.wrapTitle = this.wrapButton.prop('title');
};

Output.prototype.currentState = function () {
    var options = this.getEffectiveOptions();
    var state = {
        compiler: this.compilerId,
        editor: this.editorId,
        wrap: options.wrap
    };
    this.fontScale.addState(state);
    return state;
};

Output.prototype.saveState = function () {
    this.container.setState(this.currentState());
};

Output.prototype.onCompileResult = function (id, compiler, result) {
    if (id !== this.compilerId) return;
    if (compiler) this.compilerName = compiler.name;

    this.contentRoot.empty();

    _.each((result.stdout || []).concat(result.stderr || []), function (obj) {
        this.add(this.normalAnsiToHtml.toHtml(obj.text), obj.tag ? obj.tag.line : obj.line);
    }, this);

    this.add("Compiler returned: " + result.code);

    if (result.execResult) {
        this.add("Program returned: " + result.execResult.code);
        if (result.execResult.stderr.length || result.execResult.stdout.length) {
            _.each(result.execResult.stderr, function (obj) {
                this.programOutput(this.normalAnsiToHtml.toHtml(obj.text), "red");
            }, this);

            _.each(result.execResult.stdout, function (obj) {
                this.programOutput(this.errorAnsiToHtml.toHtml(obj.text));
            }, this);
        }
    }

    this.updateCompilerName();
};

Output.prototype.programOutput = function (msg, color) {
    var elem = $('<p></p>').appendTo(this.contentRoot)
        .html(msg)
        .addClass('program-exec-output');

    if (color)
        elem.css("color", color);
};

Output.prototype.add = function (msg, lineNum) {
    var elem = $('<p></p>').appendTo(this.contentRoot);
    if (lineNum) {
        elem.html(
            $('<a></a>')
                .prop('href', 'javascript:;')
                .html(msg)
                .click(_.bind(function (e) {
                    this.eventHub.emit('editorSetDecoration', this.editorId, lineNum, true);
                    // do not bring user to the top of index.html
                    // http://stackoverflow.com/questions/3252730
                    e.preventDefault();
                    return false;
                }, this))
                .on('mouseover', _.bind(function () {
                    this.eventHub.emit('editorSetDecoration', this.editorId, lineNum, false);
                }, this))
        );
    } else {
        elem.html(msg);
    }
};

Output.prototype.updateCompilerName = function () {
    var name = "#" + this.compilerId;
    if (this.compilerName) name += " with " + this.compilerName;
    this.container.setTitle(name);
};

Output.prototype.onCompilerClose = function (id) {
    if (id === this.compilerId) {
        // We can't immediately close as an outer loop somewhere in GoldenLayout is iterating over
        // the hierarchy. We can't modify while it's being iterated over.
        this.close();
        _.defer(function (self) {
            self.container.close();
        }, this);
    }
};

Output.prototype.close = function () {
    this.eventHub.emit('outputClosed', this.compilerId);
    this.eventHub.unsubscribe();
};

module.exports = {
    Output: Output
};
