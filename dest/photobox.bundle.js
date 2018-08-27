var PhotoBox = (function () {
'use strict';

/** Virtual DOM Node */
function VNode(nodeName, attributes, children) {
	/** @type {string|function} */
	this.nodeName = nodeName;

	/** @type {object<string>|undefined} */
	this.attributes = attributes;

	/** @type {array<VNode>|undefined} */
	this.children = children;

	/** Reference to the given key. */
	this.key = attributes && attributes.key;
}

/** Global options
 *	@public
 *	@namespace options {Object}
 */
var options = {

	/** If `true`, `prop` changes trigger synchronous component updates.
  *	@name syncComponentUpdates
  *	@type Boolean
  *	@default true
  */
	//syncComponentUpdates: true,

	/** Processes all created VNodes.
  *	@param {VNode} vnode	A newly-created VNode to normalize/process
  */
	//vnode(vnode) { }

	/** Hook invoked after a component is mounted. */
	// afterMount(component) { }

	/** Hook invoked after the DOM is updated with a component's latest render. */
	// afterUpdate(component) { }

	/** Hook invoked immediately before a component is unmounted. */
	// beforeUnmount(component) { }
};

var stack = [];

/** JSX/hyperscript reviver
*	Benchmarks: https://esbench.com/bench/57ee8f8e330ab09900a1a1a0
 *	@see http://jasonformat.com/wtf-is-jsx
 *	@public
 *  @example
 *  /** @jsx h *\/
 *  import { render, h } from 'preact';
 *  render(<span>foo</span>, document.body);
 */
function h(nodeName, attributes) {
	var children = [],
	    lastSimple = void 0,
	    child = void 0,
	    simple = void 0,
	    i = void 0;
	for (i = arguments.length; i-- > 2;) {
		stack.push(arguments[i]);
	}
	if (attributes && attributes.children) {
		if (!stack.length) stack.push(attributes.children);
		delete attributes.children;
	}
	while (stack.length) {
		if ((child = stack.pop()) instanceof Array) {
			for (i = child.length; i--;) {
				stack.push(child[i]);
			}
		} else if (child != null && child !== false) {
			if (typeof child == 'number' || child === true) child = String(child);
			simple = typeof child == 'string';
			if (simple && lastSimple) {
				children[children.length - 1] += child;
			} else {
				children.push(child);
				lastSimple = simple;
			}
		}
	}

	var p = new VNode(nodeName, attributes || undefined, children);

	// if a "vnode hook" is defined, pass every created VNode to it
	if (options.vnode) options.vnode(p);

	return p;
}

/** Copy own-properties from `props` onto `obj`.
 *	@returns obj
 *	@private
 */
function extend(obj, props) {
	if (props) {
		for (var i in props) {
			obj[i] = props[i];
		}
	}
	return obj;
}

/** Fast clone. Note: does not filter out non-own properties.
 *	@see https://esbench.com/bench/56baa34f45df6895002e03b6
 */
function clone(obj) {
	return extend({}, obj);
}

/** Get a deep property value from the given object, expressed in dot-notation.
 *	@private
 */
function delve(obj, key) {
	for (var p = key.split('.'), i = 0; i < p.length && obj; i++) {
		obj = obj[p[i]];
	}
	return obj;
}

/** @private is the given object a Function? */
function isFunction(obj) {
	return 'function' === typeof obj;
}

/** @private is the given object a String? */
function isString(obj) {
	return 'string' === typeof obj;
}

/** Convert a hashmap of CSS classes to a space-delimited className string
 *	@private
 */
function hashToClassName(c) {
	var str = '';
	for (var prop in c) {
		if (c[prop]) {
			if (str) str += ' ';
			str += prop;
		}
	}
	return str;
}

/** Just a memoized String#toLowerCase */
var lcCache = {};
var toLowerCase = function toLowerCase(s) {
	return lcCache[s] || (lcCache[s] = s.toLowerCase());
};

/** Call a function asynchronously, as soon as possible.
 *	@param {Function} callback
 */
var resolved = typeof Promise !== 'undefined' && Promise.resolve();
var defer = resolved ? function (f) {
	resolved.then(f);
} : setTimeout;

function cloneElement(vnode, props) {
	return h(vnode.nodeName, extend(clone(vnode.attributes), props), arguments.length > 2 ? [].slice.call(arguments, 2) : vnode.children);
}

// render modes

var NO_RENDER = 0;
var SYNC_RENDER = 1;
var FORCE_RENDER = 2;
var ASYNC_RENDER = 3;

var EMPTY = {};

var ATTR_KEY = typeof Symbol !== 'undefined' ? Symbol.for('preactattr') : '__preactattr_';

// DOM properties that should NOT have "px" added when numeric
var NON_DIMENSION_PROPS = {
	boxFlex: 1, boxFlexGroup: 1, columnCount: 1, fillOpacity: 1, flex: 1, flexGrow: 1,
	flexPositive: 1, flexShrink: 1, flexNegative: 1, fontWeight: 1, lineClamp: 1, lineHeight: 1,
	opacity: 1, order: 1, orphans: 1, strokeOpacity: 1, widows: 1, zIndex: 1, zoom: 1
};

// DOM event types that do not bubble and should be attached via useCapture
var NON_BUBBLING_EVENTS = { blur: 1, error: 1, focus: 1, load: 1, resize: 1, scroll: 1 };

function createLinkedState(component, key, eventPath) {
	var path = key.split('.');
	return function (e) {
		var t = e && e.target || this,
		    state = {},
		    obj = state,
		    v = isString(eventPath) ? delve(e, eventPath) : t.nodeName ? t.type.match(/^che|rad/) ? t.checked : t.value : e,
		    i = 0;
		for (; i < path.length - 1; i++) {
			obj = obj[path[i]] || (obj[path[i]] = !i && component.state[path[i]] || {});
		}
		obj[path[i]] = v;
		component.setState(state);
	};
}

var items = [];

function enqueueRender(component) {
	if (!component._dirty && (component._dirty = true) && items.push(component) == 1) {
		(options.debounceRendering || defer)(rerender);
	}
}

function rerender() {
	var p = void 0,
	    list = items;
	items = [];
	while (p = list.pop()) {
		if (p._dirty) renderComponent(p);
	}
}

function isFunctionalComponent(vnode) {
  var nodeName = vnode && vnode.nodeName;
  return nodeName && isFunction(nodeName) && !(nodeName.prototype && nodeName.prototype.render);
}

/** Construct a resultant VNode from a VNode referencing a stateless functional component.
 *	@param {VNode} vnode	A VNode with a `nodeName` property that is a reference to a function.
 *	@private
 */
function buildFunctionalComponent(vnode, context) {
  return vnode.nodeName(getNodeProps(vnode), context || EMPTY);
}

function isSameNodeType(node, vnode) {
	if (isString(vnode)) {
		return node instanceof Text;
	}
	if (isString(vnode.nodeName)) {
		return !node._componentConstructor && isNamedNode(node, vnode.nodeName);
	}
	if (isFunction(vnode.nodeName)) {
		return (node._componentConstructor ? node._componentConstructor === vnode.nodeName : true) || isFunctionalComponent(vnode);
	}
}

function isNamedNode(node, nodeName) {
	return node.normalizedNodeName === nodeName || toLowerCase(node.nodeName) === toLowerCase(nodeName);
}

/**
 * Reconstruct Component-style `props` from a VNode.
 * Ensures default/fallback values from `defaultProps`:
 * Own-properties of `defaultProps` not present in `vnode.attributes` are added.
 * @param {VNode} vnode
 * @returns {Object} props
 */
function getNodeProps(vnode) {
	var props = clone(vnode.attributes);
	props.children = vnode.children;

	var defaultProps = vnode.nodeName.defaultProps;
	if (defaultProps) {
		for (var i in defaultProps) {
			if (props[i] === undefined) {
				props[i] = defaultProps[i];
			}
		}
	}

	return props;
}

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
  return typeof obj;
} : function (obj) {
  return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
};











var classCallCheck = function (instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
};

var createClass = function () {
  function defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }

  return function (Constructor, protoProps, staticProps) {
    if (protoProps) defineProperties(Constructor.prototype, protoProps);
    if (staticProps) defineProperties(Constructor, staticProps);
    return Constructor;
  };
}();







var get = function get(object, property, receiver) {
  if (object === null) object = Function.prototype;
  var desc = Object.getOwnPropertyDescriptor(object, property);

  if (desc === undefined) {
    var parent = Object.getPrototypeOf(object);

    if (parent === null) {
      return undefined;
    } else {
      return get(parent, property, receiver);
    }
  } else if ("value" in desc) {
    return desc.value;
  } else {
    var getter = desc.get;

    if (getter === undefined) {
      return undefined;
    }

    return getter.call(receiver);
  }
};

var inherits = function (subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
  }

  subClass.prototype = Object.create(superClass && superClass.prototype, {
    constructor: {
      value: subClass,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
  if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
};







var objectDestructuringEmpty = function (obj) {
  if (obj == null) throw new TypeError("Cannot destructure undefined");
};



var possibleConstructorReturn = function (self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }

  return call && (typeof call === "object" || typeof call === "function") ? call : self;
};



var set = function set(object, property, value, receiver) {
  var desc = Object.getOwnPropertyDescriptor(object, property);

  if (desc === undefined) {
    var parent = Object.getPrototypeOf(object);

    if (parent !== null) {
      set(parent, property, value, receiver);
    }
  } else if ("value" in desc && desc.writable) {
    desc.value = value;
  } else {
    var setter = desc.set;

    if (setter !== undefined) {
      setter.call(receiver, value);
    }
  }

  return value;
};

function removeNode(node) {
	var p = node.parentNode;
	if (p) p.removeChild(node);
}

/** Set a named attribute on the given Node, with special behavior for some names and event handlers.
 *	If `value` is `null`, the attribute/handler will be removed.
 *	@param {Element} node	An element to mutate
 *	@param {string} name	The name/key to set, such as an event or attribute name
 *	@param {any} value		An attribute value, such as a function to be used as an event handler
 *	@param {any} previousValue	The last value that was set for this name/node pair
 *	@private
 */
function setAccessor(node, name, old, value, isSvg) {

	if (name === 'className') name = 'class';

	if (name === 'class' && value && (typeof value === 'undefined' ? 'undefined' : _typeof(value)) === 'object') {
		value = hashToClassName(value);
	}

	if (name === 'key') {
		// ignore
	} else if (name === 'class' && !isSvg) {
		node.className = value || '';
	} else if (name === 'style') {
		if (!value || isString(value) || isString(old)) {
			node.style.cssText = value || '';
		}
		if (value && (typeof value === 'undefined' ? 'undefined' : _typeof(value)) === 'object') {
			if (!isString(old)) {
				for (var i in old) {
					if (!(i in value)) node.style[i] = '';
				}
			}
			for (var _i in value) {
				node.style[_i] = typeof value[_i] === 'number' && !NON_DIMENSION_PROPS[_i] ? value[_i] + 'px' : value[_i];
			}
		}
	} else if (name === 'dangerouslySetInnerHTML') {
		node.innerHTML = value && value.__html || '';
	} else if (name[0] == 'o' && name[1] == 'n') {
		var l = node._listeners || (node._listeners = {});
		name = toLowerCase(name.substring(2));
		// @TODO: this might be worth it later, un-breaks focus/blur bubbling in IE9:
		// if (node.attachEvent) name = name=='focus'?'focusin':name=='blur'?'focusout':name;
		if (value) {
			if (!l[name]) node.addEventListener(name, eventProxy, !!NON_BUBBLING_EVENTS[name]);
		} else if (l[name]) {
			node.removeEventListener(name, eventProxy, !!NON_BUBBLING_EVENTS[name]);
		}
		l[name] = value;
	} else if (name !== 'list' && name !== 'type' && !isSvg && name in node) {
		setProperty(node, name, value == null ? '' : value);
		if (value == null || value === false) node.removeAttribute(name);
	} else {
		var ns = isSvg && name.match(/^xlink\:?(.+)/);
		if (value == null || value === false) {
			if (ns) node.removeAttributeNS('http://www.w3.org/1999/xlink', toLowerCase(ns[1]));else node.removeAttribute(name);
		} else if ((typeof value === 'undefined' ? 'undefined' : _typeof(value)) !== 'object' && !isFunction(value)) {
			if (ns) node.setAttributeNS('http://www.w3.org/1999/xlink', toLowerCase(ns[1]), value);else node.setAttribute(name, value);
		}
	}
}

/** Attempt to set a DOM property to the given value.
 *	IE & FF throw for certain property-value combinations.
 */
function setProperty(node, name, value) {
	try {
		node[name] = value;
	} catch (e) {}
}

/** Proxy an event to hooked event handlers
 *	@private
 */
function eventProxy(e) {
	return this._listeners[e.type](options.event && options.event(e) || e);
}

var nodes = {};

function collectNode(node) {
	removeNode(node);

	if (node instanceof Element) {
		node._component = node._componentConstructor = null;

		var name = node.normalizedNodeName || toLowerCase(node.nodeName);
		(nodes[name] || (nodes[name] = [])).push(node);
	}
}

function createNode(nodeName, isSvg) {
	var name = toLowerCase(nodeName),
	    node = nodes[name] && nodes[name].pop() || (isSvg ? document.createElementNS('http://www.w3.org/2000/svg', nodeName) : document.createElement(nodeName));
	node.normalizedNodeName = name;
	return node;
}

var mounts = [];

/** Diff recursion count, used to track the end of the diff cycle. */
var diffLevel = 0;

/** Global flag indicating if the diff is currently within an SVG */
var isSvgMode = false;

/** Global flag indicating if the diff is performing hydration */
var hydrating = false;

/** Invoke queued componentDidMount lifecycle methods */
function flushMounts() {
	var c = void 0;
	while (c = mounts.pop()) {
		if (options.afterMount) options.afterMount(c);
		if (c.componentDidMount) c.componentDidMount();
	}
}

/** Apply differences in a given vnode (and it's deep children) to a real DOM Node.
 *	@param {Element} [dom=null]		A DOM node to mutate into the shape of the `vnode`
 *	@param {VNode} vnode			A VNode (with descendants forming a tree) representing the desired DOM structure
 *	@returns {Element} dom			The created/mutated element
 *	@private
 */
function diff(dom, vnode, context, mountAll, parent, componentRoot) {
	// diffLevel having been 0 here indicates initial entry into the diff (not a subdiff)
	if (!diffLevel++) {
		// when first starting the diff, check if we're diffing an SVG or within an SVG
		isSvgMode = parent instanceof SVGElement;

		// hydration is inidicated by the existing element to be diffed not having a prop cache
		hydrating = dom && !(ATTR_KEY in dom);
	}

	var ret = idiff(dom, vnode, context, mountAll);

	// append the element if its a new parent
	if (parent && ret.parentNode !== parent) parent.appendChild(ret);

	// diffLevel being reduced to 0 means we're exiting the diff
	if (! --diffLevel) {
		hydrating = false;
		// invoke queued componentDidMount lifecycle methods
		if (!componentRoot) flushMounts();
	}

	return ret;
}

function idiff(dom, vnode, context, mountAll) {
	var originalAttributes = vnode && vnode.attributes;

	// Resolve ephemeral Pure Functional Components
	while (isFunctionalComponent(vnode)) {
		vnode = buildFunctionalComponent(vnode, context);
	}

	// empty values (null & undefined) render as empty Text nodes
	if (vnode == null) vnode = '';

	// Fast case: Strings create/update Text nodes.
	if (isString(vnode)) {
		// update if it's already a Text node
		if (dom && dom instanceof Text) {
			if (dom.nodeValue != vnode) {
				dom.nodeValue = vnode;
			}
		} else {
			// it wasn't a Text node: replace it with one and recycle the old Element
			if (dom) recollectNodeTree(dom);
			dom = document.createTextNode(vnode);
		}

		// Mark for non-hydration updates
		dom[ATTR_KEY] = true;
		return dom;
	}

	// If the VNode represents a Component, perform a component diff.
	if (isFunction(vnode.nodeName)) {
		return buildComponentFromVNode(dom, vnode, context, mountAll);
	}

	var out = dom,
	    nodeName = String(vnode.nodeName),
	    // @TODO this masks undefined component errors as `<undefined>`
	prevSvgMode = isSvgMode,
	    vchildren = vnode.children;

	// SVGs have special namespace stuff.
	// This tracks entering and exiting that namespace when descending through the tree.
	isSvgMode = nodeName === 'svg' ? true : nodeName === 'foreignObject' ? false : isSvgMode;

	if (!dom) {
		// case: we had no element to begin with
		// - create an element to with the nodeName from VNode
		out = createNode(nodeName, isSvgMode);
	} else if (!isNamedNode(dom, nodeName)) {
		// case: Element and VNode had different nodeNames
		// - need to create the correct Element to match VNode
		// - then migrate children from old to new

		out = createNode(nodeName, isSvgMode);

		// move children into the replacement node
		while (dom.firstChild) {
			out.appendChild(dom.firstChild);
		} // if the previous Element was mounted into the DOM, replace it inline
		if (dom.parentNode) dom.parentNode.replaceChild(out, dom);

		// recycle the old element (skips non-Element node types)
		recollectNodeTree(dom);
	}

	var fc = out.firstChild,
	    props = out[ATTR_KEY];

	// Attribute Hydration: if there is no prop cache on the element,
	// ...create it and populate it with the element's attributes.
	if (!props) {
		out[ATTR_KEY] = props = {};
		for (var a = out.attributes, i = a.length; i--;) {
			props[a[i].name] = a[i].value;
		}
	}

	// Apply attributes/props from VNode to the DOM Element:
	diffAttributes(out, vnode.attributes, props);

	// Optimization: fast-path for elements containing a single TextNode:
	if (!hydrating && vchildren && vchildren.length === 1 && typeof vchildren[0] === 'string' && fc && fc instanceof Text && !fc.nextSibling) {
		if (fc.nodeValue != vchildren[0]) {
			fc.nodeValue = vchildren[0];
		}
	}
	// otherwise, if there are existing or new children, diff them:
	else if (vchildren && vchildren.length || fc) {
			innerDiffNode(out, vchildren, context, mountAll);
		}

	// invoke original ref (from before resolving Pure Functional Components):
	if (originalAttributes && typeof originalAttributes.ref === 'function') {
		(props.ref = originalAttributes.ref)(out);
	}

	isSvgMode = prevSvgMode;

	return out;
}

/** Apply child and attribute changes between a VNode and a DOM Node to the DOM.
 *	@param {Element} dom		Element whose children should be compared & mutated
 *	@param {Array} vchildren	Array of VNodes to compare to `dom.childNodes`
 *	@param {Object} context		Implicitly descendant context object (from most recent `getChildContext()`)
 *	@param {Boolean} moutAll
 */
function innerDiffNode(dom, vchildren, context, mountAll) {
	var originalChildren = dom.childNodes,
	    children = [],
	    keyed = {},
	    keyedLen = 0,
	    min = 0,
	    len = originalChildren.length,
	    childrenLen = 0,
	    vlen = vchildren && vchildren.length,
	    j = void 0,
	    c = void 0,
	    vchild = void 0,
	    child = void 0;

	if (len) {
		for (var i = 0; i < len; i++) {
			var _child = originalChildren[i],
			    props = _child[ATTR_KEY],
			    key = vlen ? (c = _child._component) ? c.__key : props ? props.key : null : null;
			if (key != null) {
				keyedLen++;
				keyed[key] = _child;
			} else if (hydrating || props) {
				children[childrenLen++] = _child;
			}
		}
	}

	if (vlen) {
		for (var _i = 0; _i < vlen; _i++) {
			vchild = vchildren[_i];
			child = null;

			// if (isFunctionalComponent(vchild)) {
			// 	vchild = buildFunctionalComponent(vchild);
			// }

			// attempt to find a node based on key matching
			var _key = vchild.key;
			if (_key != null) {
				if (keyedLen && _key in keyed) {
					child = keyed[_key];
					keyed[_key] = undefined;
					keyedLen--;
				}
			}
			// attempt to pluck a node of the same type from the existing children
			else if (!child && min < childrenLen) {
					for (j = min; j < childrenLen; j++) {
						c = children[j];
						if (c && isSameNodeType(c, vchild)) {
							child = c;
							children[j] = undefined;
							if (j === childrenLen - 1) childrenLen--;
							if (j === min) min++;
							break;
						}
					}
				}

			// morph the matched/found/created DOM child to match vchild (deep)
			child = idiff(child, vchild, context, mountAll);

			if (child && child !== dom) {
				if (_i >= len) {
					dom.appendChild(child);
				} else if (child !== originalChildren[_i]) {
					if (child === originalChildren[_i + 1]) {
						removeNode(originalChildren[_i]);
					}
					dom.insertBefore(child, originalChildren[_i] || null);
				}
			}
		}
	}

	if (keyedLen) {
		for (var _i2 in keyed) {
			if (keyed[_i2]) recollectNodeTree(keyed[_i2]);
		}
	}

	// remove orphaned children
	while (min <= childrenLen) {
		child = children[childrenLen--];
		if (child) recollectNodeTree(child);
	}
}

/** Recursively recycle (or just unmount) a node an its descendants.
 *	@param {Node} node						DOM node to start unmount/removal from
 *	@param {Boolean} [unmountOnly=false]	If `true`, only triggers unmount lifecycle, skips removal
 */
function recollectNodeTree(node, unmountOnly) {
	var component = node._component;
	if (component) {
		// if node is owned by a Component, unmount that component (ends up recursing back here)
		unmountComponent(component, !unmountOnly);
	} else {
		// If the node's VNode had a ref function, invoke it with null here.
		// (this is part of the React spec, and smart for unsetting references)
		if (node[ATTR_KEY] && node[ATTR_KEY].ref) node[ATTR_KEY].ref(null);

		if (!unmountOnly) {
			collectNode(node);
		}

		// Recollect/unmount all children.
		// - we use .lastChild here because it causes less reflow than .firstChild
		// - it's also cheaper than accessing the .childNodes Live NodeList
		var c = void 0;
		while (c = node.lastChild) {
			recollectNodeTree(c, unmountOnly);
		}
	}
}

/** Apply differences in attributes from a VNode to the given DOM Element.
 *	@param {Element} dom		Element with attributes to diff `attrs` against
 *	@param {Object} attrs		The desired end-state key-value attribute pairs
 *	@param {Object} old			Current/previous attributes (from previous VNode or element's prop cache)
 */
function diffAttributes(dom, attrs, old) {
	// remove attributes no longer present on the vnode by setting them to undefined
	for (var name in old) {
		if (!(attrs && name in attrs) && old[name] != null) {
			setAccessor(dom, name, old[name], old[name] = undefined, isSvgMode);
		}
	}

	// add new & update changed attributes
	if (attrs) {
		for (var _name in attrs) {
			if (_name !== 'children' && _name !== 'innerHTML' && (!(_name in old) || attrs[_name] !== (_name === 'value' || _name === 'checked' ? dom[_name] : old[_name]))) {
				setAccessor(dom, _name, old[_name], old[_name] = attrs[_name], isSvgMode);
			}
		}
	}
}

var components = {};

function collectComponent(component) {
	var name = component.constructor.name,
	    list = components[name];
	if (list) list.push(component);else components[name] = [component];
}

function createComponent(Ctor, props, context) {
	var inst = new Ctor(props, context),
	    list = components[Ctor.name];
	Component.call(inst, props, context);
	if (list) {
		for (var i = list.length; i--;) {
			if (list[i].constructor === Ctor) {
				inst.nextBase = list[i].nextBase;
				list.splice(i, 1);
				break;
			}
		}
	}
	return inst;
}

function setComponentProps(component, props, opts, context, mountAll) {
	if (component._disable) return;
	component._disable = true;

	if (component.__ref = props.ref) delete props.ref;
	if (component.__key = props.key) delete props.key;

	if (!component.base || mountAll) {
		if (component.componentWillMount) component.componentWillMount();
	} else if (component.componentWillReceiveProps) {
		component.componentWillReceiveProps(props, context);
	}

	if (context && context !== component.context) {
		if (!component.prevContext) component.prevContext = component.context;
		component.context = context;
	}

	if (!component.prevProps) component.prevProps = component.props;
	component.props = props;

	component._disable = false;

	if (opts !== NO_RENDER) {
		if (opts === SYNC_RENDER || options.syncComponentUpdates !== false || !component.base) {
			renderComponent(component, SYNC_RENDER, mountAll);
		} else {
			enqueueRender(component);
		}
	}

	if (component.__ref) component.__ref(component);
}

/** Render a Component, triggering necessary lifecycle events and taking High-Order Components into account.
 *	@param {Component} component
 *	@param {Object} [opts]
 *	@param {boolean} [opts.build=false]		If `true`, component will build and store a DOM node if not already associated with one.
 *	@private
 */
function renderComponent(component, opts, mountAll, isChild) {
	if (component._disable) return;

	var skip = void 0,
	    rendered = void 0,
	    props = component.props,
	    state = component.state,
	    context = component.context,
	    previousProps = component.prevProps || props,
	    previousState = component.prevState || state,
	    previousContext = component.prevContext || context,
	    isUpdate = component.base,
	    nextBase = component.nextBase,
	    initialBase = isUpdate || nextBase,
	    initialChildComponent = component._component,
	    inst = void 0,
	    cbase = void 0;

	// if updating
	if (isUpdate) {
		component.props = previousProps;
		component.state = previousState;
		component.context = previousContext;
		if (opts !== FORCE_RENDER && component.shouldComponentUpdate && component.shouldComponentUpdate(props, state, context) === false) {
			skip = true;
		} else if (component.componentWillUpdate) {
			component.componentWillUpdate(props, state, context);
		}
		component.props = props;
		component.state = state;
		component.context = context;
	}

	component.prevProps = component.prevState = component.prevContext = component.nextBase = null;
	component._dirty = false;

	if (!skip) {
		if (component.render) rendered = component.render(props, state, context);

		// context to pass to the child, can be updated via (grand-)parent component
		if (component.getChildContext) {
			context = extend(clone(context), component.getChildContext());
		}

		while (isFunctionalComponent(rendered)) {
			rendered = buildFunctionalComponent(rendered, context);
		}

		var childComponent = rendered && rendered.nodeName,
		    toUnmount = void 0,
		    base = void 0;

		if (isFunction(childComponent)) {
			// set up high order component link

			var childProps = getNodeProps(rendered);
			inst = initialChildComponent;

			if (inst && inst.constructor === childComponent && childProps.key == inst.__key) {
				setComponentProps(inst, childProps, SYNC_RENDER, context);
			} else {
				toUnmount = inst;

				inst = createComponent(childComponent, childProps, context);
				inst.nextBase = inst.nextBase || nextBase;
				inst._parentComponent = component;
				component._component = inst;
				setComponentProps(inst, childProps, NO_RENDER, context);
				renderComponent(inst, SYNC_RENDER, mountAll, true);
			}

			base = inst.base;
		} else {
			cbase = initialBase;

			// destroy high order component link
			toUnmount = initialChildComponent;
			if (toUnmount) {
				cbase = component._component = null;
			}

			if (initialBase || opts === SYNC_RENDER) {
				if (cbase) cbase._component = null;
				base = diff(cbase, rendered, context, mountAll || !isUpdate, initialBase && initialBase.parentNode, true);
			}
		}

		if (initialBase && base !== initialBase && inst !== initialChildComponent) {
			var baseParent = initialBase.parentNode;
			if (baseParent && base !== baseParent) {
				baseParent.replaceChild(base, initialBase);

				if (!toUnmount) {
					initialBase._component = null;
					recollectNodeTree(initialBase);
				}
			}
		}

		if (toUnmount) {
			unmountComponent(toUnmount, base !== initialBase);
		}

		component.base = base;
		if (base && !isChild) {
			var componentRef = component,
			    t = component;
			while (t = t._parentComponent) {
				(componentRef = t).base = base;
			}
			base._component = componentRef;
			base._componentConstructor = componentRef.constructor;
		}
	}

	if (!isUpdate || mountAll) {
		mounts.unshift(component);
	} else if (!skip) {
		if (component.componentDidUpdate) {
			component.componentDidUpdate(previousProps, previousState, previousContext);
		}
		if (options.afterUpdate) options.afterUpdate(component);
	}

	var cb = component._renderCallbacks,
	    fn = void 0;
	if (cb) while (fn = cb.pop()) {
		fn.call(component);
	}if (!diffLevel && !isChild) flushMounts();
}

/** Apply the Component referenced by a VNode to the DOM.
 *	@param {Element} dom	The DOM node to mutate
 *	@param {VNode} vnode	A Component-referencing VNode
 *	@returns {Element} dom	The created/mutated element
 *	@private
 */
function buildComponentFromVNode(dom, vnode, context, mountAll) {
	var c = dom && dom._component,
	    oldDom = dom,
	    isDirectOwner = c && dom._componentConstructor === vnode.nodeName,
	    isOwner = isDirectOwner,
	    props = getNodeProps(vnode);
	while (c && !isOwner && (c = c._parentComponent)) {
		isOwner = c.constructor === vnode.nodeName;
	}

	if (c && isOwner && (!mountAll || c._component)) {
		setComponentProps(c, props, ASYNC_RENDER, context, mountAll);
		dom = c.base;
	} else {
		if (c && !isDirectOwner) {
			unmountComponent(c, true);
			dom = oldDom = null;
		}

		c = createComponent(vnode.nodeName, props, context);
		if (dom && !c.nextBase) {
			c.nextBase = dom;
			// passing dom/oldDom as nextBase will recycle it if unused, so bypass recycling on L241:
			oldDom = null;
		}
		setComponentProps(c, props, SYNC_RENDER, context, mountAll);
		dom = c.base;

		if (oldDom && dom !== oldDom) {
			oldDom._component = null;
			recollectNodeTree(oldDom);
		}
	}

	return dom;
}

/** Remove a component from the DOM and recycle it.
 *	@param {Element} dom			A DOM node from which to unmount the given Component
 *	@param {Component} component	The Component instance to unmount
 *	@private
 */
function unmountComponent(component, remove) {
	if (options.beforeUnmount) options.beforeUnmount(component);

	// console.log(`${remove?'Removing':'Unmounting'} component: ${component.constructor.name}`);
	var base = component.base;

	component._disable = true;

	if (component.componentWillUnmount) component.componentWillUnmount();

	component.base = null;

	// recursively tear down & recollect high-order component children:
	var inner = component._component;
	if (inner) {
		unmountComponent(inner, remove);
	} else if (base) {
		if (base[ATTR_KEY] && base[ATTR_KEY].ref) base[ATTR_KEY].ref(null);

		component.nextBase = base;

		if (remove) {
			removeNode(base);
			collectComponent(component);
		}
		var c = void 0;
		while (c = base.lastChild) {
			recollectNodeTree(c, !remove);
		} // removeOrphanedChildren(base.childNodes, true);
	}

	if (component.__ref) component.__ref(null);
	if (component.componentDidUnmount) component.componentDidUnmount();
}

function Component(props, context) {
	/** @private */
	this._dirty = true;
	// /** @public */
	// this._disableRendering = false;
	// /** @public */
	// this.prevState = this.prevProps = this.prevContext = this.base = this.nextBase = this._parentComponent = this._component = this.__ref = this.__key = this._linkedStates = this._renderCallbacks = null;
	/** @public */
	this.context = context;
	/** @type {object} */
	this.props = props;
	/** @type {object} */
	if (!this.state) this.state = {};
}

extend(Component.prototype, {

	/** Returns a `boolean` value indicating if the component should re-render when receiving the given `props` and `state`.
  *	@param {object} nextProps
  *	@param {object} nextState
  *	@param {object} nextContext
  *	@returns {Boolean} should the component re-render
  *	@name shouldComponentUpdate
  *	@function
  */
	// shouldComponentUpdate() {
	// 	return true;
	// },


	/** Returns a function that sets a state property when called.
  *	Calling linkState() repeatedly with the same arguments returns a cached link function.
  *
  *	Provides some built-in special cases:
  *		- Checkboxes and radio buttons link their boolean `checked` value
  *		- Inputs automatically link their `value` property
  *		- Event paths fall back to any associated Component if not found on an element
  *		- If linked value is a function, will invoke it and use the result
  *
  *	@param {string} key				The path to set - can be a dot-notated deep key
  *	@param {string} [eventPath]		If set, attempts to find the new state value at a given dot-notated path within the object passed to the linkedState setter.
  *	@returns {function} linkStateSetter(e)
  *
  *	@example Update a "text" state value when an input changes:
  *		<input onChange={ this.linkState('text') } />
  *
  *	@example Set a deep state value on click
  *		<button onClick={ this.linkState('touch.coords', 'touches.0') }>Tap</button
  */
	linkState: function linkState(key, eventPath) {
		var c = this._linkedStates || (this._linkedStates = {});
		return c[key + eventPath] || (c[key + eventPath] = createLinkedState(this, key, eventPath));
	},


	/** Update component state by copying properties from `state` to `this.state`.
  *	@param {object} state		A hash of state properties to update with new values
  */
	setState: function setState(state, callback) {
		var s = this.state;
		if (!this.prevState) this.prevState = clone(s);
		extend(s, isFunction(state) ? state(s, this.props) : state);
		if (callback) (this._renderCallbacks = this._renderCallbacks || []).push(callback);
		enqueueRender(this);
	},


	/** Immediately perform a synchronous re-render of the component.
  *	@private
  */
	forceUpdate: function forceUpdate() {
		renderComponent(this, FORCE_RENDER);
	},


	/** Accepts `props` and `state`, and returns a new Virtual DOM tree to build.
  *	Virtual DOM is generally constructed via [JSX](http://jasonformat.com/wtf-is-jsx).
  *	@param {object} props		Props (eg: JSX attributes) received from parent element/component
  *	@param {object} state		The component's current state
  *	@param {object} context		Context object (if a parent component has provided context)
  *	@returns VNode
  */
	render: function render() {}
});

function render$1(vnode, parent, merge) {
  return diff(merge, vnode, {}, false, parent);
}

var Events = function () {
  function Events() {
    classCallCheck(this, Events);

    this.targets = {};
  }

  createClass(Events, [{
    key: "on",
    value: function on(eventType, fn) {
      this.targets[eventType] = this.targets[eventType] || [];
      this.targets[eventType].push(fn);
    }
  }, {
    key: "off",
    value: function off(eventType, fn) {
      this.targets[eventType] = this.targets[eventType].filter(function (t) {
        return t !== fn;
      });
    }
  }, {
    key: "fire",
    value: function fire(eventType) {
      for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }

      (this.targets[eventType] || []).forEach(function (fn) {
        return fn.apply(undefined, args);
      });
    }
  }]);
  return Events;
}();

var hexToRgb = function hexToRgb(_hex) {
  var hex = _hex;
  if (hex[0] !== '#') {
    hex = '#' + hex;
  }
  if (hex.length === 4) {
    var r = parseInt(hex.slice(1, 2) + hex.slice(1, 2), 16),
        g = parseInt(hex.slice(2, 3) + hex.slice(2, 3), 16),
        b = parseInt(hex.slice(3, 4) + hex.slice(3, 4), 16);
    return { r: r, g: g, b: b };
  }
  if (hex.length === 7) {
    var _r = parseInt(hex.slice(1, 3), 16),
        _g = parseInt(hex.slice(3, 5), 16),
        _b = parseInt(hex.slice(5, 7), 16);
    return { r: _r, g: _g, b: _b };
  }
  throw new Error('Bad hex provided');
};

var rgba = function rgba(_ref) {
  var r = _ref.r,
      g = _ref.g,
      b = _ref.b;
  var alpha = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 1;

  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
};

var SVGSymbols = function SVGSymbols() {
  return h(
    "div",
    { style: "display:block;width:0;height:0;" },
    h(
      "svg",
      null,
      h(
        "symbol",
        { id: "add-photo", viewBox: "0 0 66 66" },
        h(
          "g",
          { transform: "translate(1 1)", "stroke-width": "2", stroke: "currentColor", fill: "none", "fill-rule": "evenodd" },
          h("path", { d: "M42.343 41.958c-3.932-.828-8.786-1.425-14.61-1.425-11.882 0-19.727 2.487-23.95 4.36A6.376 6.376 0 0 0 0 50.738v11.129h34.133M12.8 14.933C12.8 6.686 19.486 0 27.733 0c8.248 0 14.934 6.686 14.934 14.933C42.667 23.181 35.98 32 27.733 32 19.486 32 12.8 23.18 12.8 14.933zM51.2 46.933v8.534M46.933 51.2h8.534" }),
          h("circle", { cx: "51.2", cy: "51.2", r: "12.8" })
        )
      ),
      h(
        "symbol",
        { id: "upload", viewBox: "0 0 20 14" },
        h("path", { d: "M16.71 5.839C16.258 2.484 13.42 0 10 0a6.732 6.732 0 0 0-6.42 4.613C1.485 5.065 0 6.87 0 9.033c0 2.354 1.839 4.322 4.194 4.515h12.29c1.968-.193 3.516-1.87 3.516-3.87a3.913 3.913 0 0 0-3.29-3.84zm-3.258 1.806a.293.293 0 0 1-.226.097.293.293 0 0 1-.226-.097l-2.677-2.677v6.322c0 .194-.13.323-.323.323-.194 0-.323-.13-.323-.323V4.968L7 7.645a.312.312 0 0 1-.452 0 .312.312 0 0 1 0-.451l3.226-3.226c.032-.033.065-.065.097-.065.064-.032.161-.032.258 0 .032.032.065.032.097.065l3.226 3.226a.312.312 0 0 1 0 .451z", stroke: "none", fill: "currentColor", "fill-rule": "evenodd" })
      ),
      h(
        "symbol",
        { id: "take-picture", viewBox: "0 0 18 16" },
        h("path", { d: "M6.097 1.161H2.032v-.87c0-.16.13-.291.29-.291h3.484c.16 0 .29.13.29.29v.871zM17.42 1.742H.58a.58.58 0 0 0-.58.58v12.775c0 .32.26.58.58.58h16.84c.32 0 .58-.26.58-.58V2.323a.58.58 0 0 0-.58-.581zM4.064 5.516a.581.581 0 1 1 0-1.162.581.581 0 0 1 0 1.162zm7.258 7.258A3.779 3.779 0 0 1 7.548 9a3.779 3.779 0 0 1 3.775-3.774A3.779 3.779 0 0 1 15.097 9a3.779 3.779 0 0 1-3.774 3.774z", stroke: "none", fill: "currentColor", "fill-rule": "evenodd" })
      )
    )
  );
};

var PhotoBoxProgress = function PhotoBoxProgress(_ref) {
  var options$$1 = _ref.options,
      step = _ref.step;
  var className = options$$1.className;

  return h(
    'div',
    { 'class': className + '-progress' },
    h(
      'ul',
      { 'class': className + '-progressList' },
      [1, 2].map(function (i) {
        var classes = [className + '-progressList-item'];
        if (i === step) {
          classes.push('is-selected');
        }
        return h('li', { 'class': classes.join(' ') });
      })
    )
  );
};

var Icon = function Icon(_ref) {
  var name = _ref.name;

  return h(
    'svg',
    null,
    h('use', { xlinkHref: '#' + name })
  );
};

var withCSS = function withCSS(WrappedComponent, css) {
  var WithCSS = function (_Component) {
    inherits(WithCSS, _Component);

    function WithCSS() {
      classCallCheck(this, WithCSS);
      return possibleConstructorReturn(this, (WithCSS.__proto__ || Object.getPrototypeOf(WithCSS)).apply(this, arguments));
    }

    createClass(WithCSS, [{
      key: 'componentWillMount',
      value: function componentWillMount() {
        var _this2 = this;

        var _props$options = this.props.options,
            theme = _props$options.theme,
            color = _props$options.color,
            className = _props$options.className,
            size = _props$options.size;

        this.$style = document.createElement('style');
        document.head.insertBefore(this.$style, document.head.firstChild);

        var primaryColor = theme === 'light' ? hexToRgb('#fff') : hexToRgb('#555');
        var secondaryColor = hexToRgb(color);
        var rules = css({ className: className, size: size, primaryColor: primaryColor, secondaryColor: secondaryColor }, this.props).split(/\}\n[\s]*\./g).filter(function (r) {
          return !!r;
        }).map(function (r, i, arr) {
          if (i === 0) {
            return r + '}';
          } else if (i === arr.length - 1) {
            return '.' + r;
          } else {
            return '.' + r + '}';
          }
        });
        rules.forEach(function (rule, i) {
          _this2.$style.sheet.insertRule(rule, i);
        });
      }
    }, {
      key: 'componentWillUnmount',
      value: function componentWillUnmount() {
        this.$style.parentNode.removeChild(this.$style);
      }
    }, {
      key: 'render',
      value: function render() {
        return h(WrappedComponent, this.props);
      }
    }]);
    return WithCSS;
  }(Component);

  return WithCSS;
};

var css$1 = function css$1(_ref, _ref2) {
  var className = _ref.className,
      size = _ref.size,
      primaryColor = _ref.primaryColor,
      secondaryColor = _ref.secondaryColor;
  objectDestructuringEmpty(_ref2);
  return '\n  .' + className + '-actionBar {\n    padding: 10px;\n    text-align: center;\n  }\n  .' + className + '-actionBar-list {\n    list-style-type: none;\n    font-size: 0;\n    margin: 0;\n    padding-left: 0;\n  }\n  .' + className + '-actionBar-item {\n    display: inline-block;\n  }\n  .' + className + '-actionBar-item:not(:last-child) {\n    margin-right: 10px;\n  }\n  .' + className + '-actionBar-btn {\n    position: relative;\n    width: 32px;\n    height: 32px;\n    border-radius: 3px;\n    background-color: ' + rgba(secondaryColor, .5) + ';\n    color: ' + rgba(primaryColor) + ';\n    cursor: pointer;\n  }\n  .' + className + '-actionBar-item.is-selected .' + className + '-actionBar-btn {\n    background-color: ' + rgba(secondaryColor) + ';\n  }\n  .' + className + '-actionBar-btn svg {\n    position: absolute;\n    top: 50%;\n    left: 50%;\n    transform: translate(-50%, -50%);\n    display: block;\n    width: 18px;\n    height: 18px;\n  }\n';
};

var PhotoBoxActionBarItem = function PhotoBoxActionBarItem(_ref3) {
  var options$$1 = _ref3.options,
      icon = _ref3.icon,
      isSelected = _ref3.isSelected,
      onPress = _ref3.onPress;
  var className = options$$1.className;

  var classes = [className + '-actionBar-item'];
  if (isSelected) {
    classes.push('is-selected');
  }
  return h(
    'li',
    { 'class': classes.join(' ') },
    h(
      'div',
      { 'class': className + '-actionBar-btn', onClick: onPress },
      h(Icon, { name: icon })
    )
  );
};

var PhotoBoxActionBar = withCSS(function (_ref4) {
  var options$$1 = _ref4.options,
      children = _ref4.children;
  var className = options$$1.className;

  return h(
    'div',
    { 'class': className + '-actionBar' },
    h(
      'ul',
      { 'class': className + '-actionBar-list' },
      children.map(function (child) {
        return cloneElement(child, { options: options$$1 });
      })
    )
  );
}, css$1);

var PhotoBoxStep1 = function (_Component) {
  inherits(PhotoBoxStep1, _Component);

  function PhotoBoxStep1() {
    var _ref;

    classCallCheck(this, PhotoBoxStep1);

    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var _this = possibleConstructorReturn(this, (_ref = PhotoBoxStep1.__proto__ || Object.getPrototypeOf(PhotoBoxStep1)).call.apply(_ref, [this].concat(args)));

    _this.state = {};
    _this.handleActionBoxClick = function (e) {
      _this.$fileChooser.dispatchEvent(new MouseEvent('click', {
        'view': window,
        'bubbles': false,
        'cancelable': true
      }));
    };
    _this._handleFileInputChange = function (e) {
      var selectedFile = e.target.files[0];
      _this.props.selectFile(selectedFile);
    };
    return _this;
  }

  createClass(PhotoBoxStep1, [{
    key: 'componentDidMount',
    value: function componentDidMount() {
      this.$fileChooser.addEventListener('change', this._handleFileInputChange);
    }
  }, {
    key: 'render',
    value: function render() {
      var _this2 = this;

      var options$$1 = this.props.options;
      var className = options$$1.className;

      return h(
        'div',
        null,
        h(
          'div',
          { 'class': className + '-primaryBox' },
          h(
            'div',
            {
              'class': className + '-actionBox',
              onClick: this.handleActionBoxClick
            },
            h(
              'div',
              { 'class': className + '-actionBox-content' },
              h(
                'div',
                { 'class': className + '-actionBox-content-picWrap' },
                h(
                  'div',
                  { 'class': className + '-actionBox-content-pic' },
                  h(Icon, { name: 'add-photo' })
                )
              ),
              h(
                'div',
                { 'class': className + '-actionBox-content-choose' },
                'Choose Photo'
              ),
              h(
                'div',
                { 'class': className + '-actionBox-content-drag' },
                'or drag an image file here'
              ),
              h('input', {
                type: 'file',
                accept: 'image/*',
                'class': className + '-actionBox-file-chooser',
                ref: function ref($el) {
                  return _this2.$fileChooser = $el;
                }
              })
            )
          )
        ),
        h(
          PhotoBoxActionBar,
          { options: options$$1 },
          h(PhotoBoxActionBarItem, { isSelected: true, icon: 'upload' }),
          h(PhotoBoxActionBarItem, { isSelected: false, icon: 'take-picture' })
        )
      );
    }
  }]);
  return PhotoBoxStep1;
}(Component);

var PhotoBoxStep2 = function (_Component) {
  inherits(PhotoBoxStep2, _Component);

  function PhotoBoxStep2() {
    var _ref;

    classCallCheck(this, PhotoBoxStep2);

    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var _this = possibleConstructorReturn(this, (_ref = PhotoBoxStep2.__proto__ || Object.getPrototypeOf(PhotoBoxStep2)).call.apply(_ref, [this].concat(args)));

    _this.state = {};
    return _this;
  }

  createClass(PhotoBoxStep2, [{
    key: 'componentDidMount',
    value: function componentDidMount() {
      var selectedFile = this.props.selectedFile;

      console.log('selectedFile', selectedFile);

      var img = document.createElement("img");
      img.classList.add("obj");
      img.file = selectedFile;
      img.style.width = '100%';
      img.style.height = '100%';
      this.$preview.appendChild(img);

      var reader = new FileReader();
      reader.onload = function (aImg) {
        return function (e) {
          aImg.src = e.target.result;
        };
      }(img);
      reader.readAsDataURL(selectedFile);
    }
  }, {
    key: 'render',
    value: function render() {
      var _this2 = this;

      var options$$1 = this.props.options;
      var className = options$$1.className;

      return h(
        'div',
        null,
        h(
          'div',
          { 'class': className + '-primaryBox' },
          h(
            'div',
            { 'class': className + '-actionBox' },
            h('div', {
              'class': className + '-actionBox-content',
              ref: function ref($el) {
                return _this2.$preview = $el;
              }
            })
          )
        ),
        h(
          PhotoBoxActionBar,
          { options: options$$1 },
          h(PhotoBoxActionBarItem, { isSelected: true, icon: 'upload' }),
          h(PhotoBoxActionBarItem, { isSelected: false, icon: 'take-picture' })
        )
      );
    }
  }]);
  return PhotoBoxStep2;
}(Component);

var css = function css(_ref, _ref2) {
  var className = _ref.className,
      size = _ref.size,
      primaryColor = _ref.primaryColor,
      secondaryColor = _ref.secondaryColor;
  objectDestructuringEmpty(_ref2);
  return '\n  .' + className + 'Container {\n    display: inline-block;\n    position: absolute;\n    opacity: 0;\n    font-family: inherit;\n    background-color: ' + rgba(primaryColor) + ';\n    border: 1px solid ' + rgba(secondaryColor, .5) + ';\n    border-radius: 3px;\n    box-shadow: 0 2px 20px rgba(0,0,0, .15);\n    transition: opacity .2s ease-in-out;\n  }\n  .' + className + ' {\n    position: relative;\n  }\n  .' + className + '-anchor {\n    display: inline-block;\n    position: absolute;\n    bottom: 100%;\n    left: 50%;\n    transform: translateX(-50%);\n    width: 0;\n    height: 0;\n    border-color: transparent;\n    border-bottom-color: ' + rgba(secondaryColor, .5) + ';\n    border-style: solid;\n    border-width: 0 6px 6px 6px;\n  }\n\n  .' + className + '-primaryBox {\n    padding: 10px;\n    background-color: ' + rgba(secondaryColor, .1) + ';\n  }\n  .' + className + '-actionBox {\n    position: relative;\n    width: ' + size + 'px;\n    height: ' + size + 'px;\n    text-align: center;\n    cursor: pointer;\n    background-color: ' + rgba(primaryColor) + ';\n    border: 2px dashed ' + rgba(secondaryColor, 1) + ';\n  }\n  .' + className + '-actionBox-content {\n    position: absolute;\n    top: 50%;\n    left: 50%;\n    width: 100%;\n    padding: 0 10px;\n    transform: translate(-50%, -50%);\n    display: block;\n  }\n  .' + className + '-actionBox-content-picWrap {\n    display: ' + (size > 160 ? 'block' : 'none') + ';\n    margin-bottom: ' + size / 12 + 'px;\n  }\n  .' + className + '-actionBox-content-pic {\n    display: inline-block;\n    color: ' + rgba(secondaryColor) + ';\n  }\n  .' + className + '-actionBox-content-pic svg {\n    display: block;\n    width: ' + size / 3.75 + 'px;\n    height: ' + size / 3.75 + 'px;\n  }\n  .' + className + '-actionBox-content-choose {\n    display: inline-block;\n    padding-bottom: 4px;\n    border-bottom: 2px solid ' + rgba(secondaryColor) + ';\n    font-weight: bold;\n    color: ' + rgba(secondaryColor) + ';\n  }\n  .' + className + '-actionBox-content-drag {\n    margin-top: 10px;\n    color: ' + rgba(secondaryColor, .5) + ';\n  }\n  .' + className + '-actionBox-file-chooser {\n    position: absolute;\n    top: 0;\n    left: 0;\n    display: block;\n    width: 1px;\n    height: 1px;\n    opacity: 0;\n  }\n\n  .' + className + '-progress {\n    padding: 10px;\n    text-align: center;\n    border-top: 2px solid ' + rgba(secondaryColor, .1) + ';\n  }\n  .' + className + '-progressList {\n    list-style-type: none;\n    margin: 0;\n    font-size: 0;\n    padding-left: 0;\n  }\n  .' + className + '-progressList-item {\n    display: inline-block;\n    width: 6px;\n    height: 6px;\n    border-radius: 100%;\n    background-color: ' + rgba(secondaryColor, .25) + ';\n  }\n  .' + className + '-progressList-item:not(:last-child) {\n    margin-right: 4px;\n  }\n  .' + className + '-progressList-item.is-selected {\n    background-color: ' + rgba(secondaryColor) + ';\n  }\n';
};

var PhotoBox$2 = function (_Component) {
  inherits(PhotoBox, _Component);

  function PhotoBox() {
    var _ref3;

    classCallCheck(this, PhotoBox);

    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var _this = possibleConstructorReturn(this, (_ref3 = PhotoBox.__proto__ || Object.getPrototypeOf(PhotoBox)).call.apply(_ref3, [this].concat(args)));

    _this.state = {
      step: 1,
      selectedFile: null
    };
    _this.selectFile = function (file) {
      _this.setState({
        selectedFile: file,
        step: 2
      });
    };
    return _this;
  }

  createClass(PhotoBox, [{
    key: 'render',
    value: function render() {
      var options$$1 = this.props.options;
      var _state = this.state,
          step = _state.step,
          selectedFile = _state.selectedFile;
      var className = options$$1.className;

      return h(
        'div',
        { className: className },
        h(SVGSymbols, null),
        h('span', { 'class': className + '-anchor' }),
        step === 1 && h(PhotoBoxStep1, {
          selectFile: this.selectFile,
          options: options$$1
        }),
        step === 2 && h(PhotoBoxStep2, {
          selectedFile: selectedFile,
          options: options$$1
        }),
        h(PhotoBoxProgress, { options: options$$1, step: step })
      );
    }
  }]);
  return PhotoBox;
}(Component);

var PhotoBoxComponent = withCSS(PhotoBox$2, css);

var NullPhotoBoxTarget = function () {
  function NullPhotoBoxTarget() {
    classCallCheck(this, NullPhotoBoxTarget);
  }

  createClass(NullPhotoBoxTarget, [{
    key: 'init',
    value: function init() {
      return this;
    }
  }, {
    key: 'destroy',
    value: function destroy() {}
  }, {
    key: 'position',
    value: function position() {}
  }]);
  return NullPhotoBoxTarget;
}();

var PhotoBoxTarget = function () {
  function PhotoBoxTarget(photoBox, $target) {
    var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    classCallCheck(this, PhotoBoxTarget);

    this.photoBox = photoBox;
    this.$target = $target;
    this.options = options;

    this._handleTargetClick = this._handleTargetClick.bind(this);
    this._handleWindowResize = this._handleWindowResize.bind(this);

    this.$target.addEventListener('click', this._handleTargetClick);
    window.addEventListener('resize', this._handleWindowResize);
  }

  createClass(PhotoBoxTarget, [{
    key: '_handleTargetClick',
    value: function _handleTargetClick(e) {
      e.stopPropagation();
      this.photoBox.toggle();
    }
  }, {
    key: '_handleWindowResize',
    value: function _handleWindowResize(e) {
      this.position();
    }
  }, {
    key: 'destroy',
    value: function destroy() {
      this.$target.removeEventListener('click', this._handleTargetClick);
      window.removeEventListener('resize', this._handleWindowResize);
    }
  }, {
    key: 'position',
    value: function position() {
      var rect = this.$target.getBoundingClientRect();
      this.photoBox.setPosition({
        top: rect.top + rect.height + 6 * 2,
        left: rect.left - (this.photoBox.$el.offsetWidth / 2 - rect.width / 2)
      });
    }
  }]);
  return PhotoBoxTarget;
}();

var PhotoBox = function () {
  function PhotoBox() {
    var options$$1 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    classCallCheck(this, PhotoBox);

    this.$container = document.querySelector('body');
    this.events = new Events();
    var defaults$$1 = {
      attachToTarget: null,
      theme: 'light',
      color: '#455054',
      className: 'PhotoBox',
      size: 240
    };
    this.opened = false;
    this.options = Object.assign({}, defaults$$1, options$$1);

    this.target = this.options.attachToTarget ? new PhotoBoxTarget(this, this.options.attachToTarget) : new NullPhotoBoxTarget();

    this._handleDocumentClick = this._handleDocumentClick.bind(this);
    this._handleDocumentKeyup = this._handleDocumentKeyup.bind(this);

    document.addEventListener('click', this._handleDocumentClick);
    document.addEventListener('keyup', this._handleDocumentKeyup);

    this.$el = document.createElement('div');
    this.$el.classList.add(this.options.className + 'Container');
    this.$el.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    this.$elPreact = render$1(h(PhotoBoxComponent, {
      options: this.options,
      events: this.events
    }), this.$el);

    this.$container.appendChild(this.$el);
  }

  createClass(PhotoBox, [{
    key: '_handleDocumentClick',
    value: function _handleDocumentClick(e) {
      this.close();
    }
  }, {
    key: '_handleDocumentKeyup',
    value: function _handleDocumentKeyup(e) {
      if (e.keyCode === 27) {
        this.close();
      }
    }
  }, {
    key: 'destroy',
    value: function destroy() {
      document.removeEventListener('click', this._handleDocumentClick);
      document.removeEventListener('keyup', this._handleDocumentKeyup);

      render$1(h(function () {
        return null;
      }), this.$el, this.$elPreact);
      this.$el.parentNode.removeChild(this.$el);

      this.target.destroy();
    }
  }, {
    key: 'toggle',
    value: function toggle() {
      this.opened ? this.close() : this.open();
    }
  }, {
    key: 'open',
    value: function open() {
      this.opened = true;
      this.$el.style.opacity = 1;
      this.$el.style.pointerEvents = 'auto';
      this.target.position();
    }
  }, {
    key: 'close',
    value: function close() {
      this.$el.style.opacity = 0;
      this.$el.style.pointerEvents = 'none';
      this.opened = false;
    }
  }, {
    key: 'setPosition',
    value: function setPosition(_ref) {
      var _this = this;

      var top = _ref.top,
          left = _ref.left;

      (window.requestIdleCallback || window.setTimeout)(function () {
        _this.$el.style.top = top + 'px';
        _this.$el.style.left = left + 'px';
        _this.events.fire('position', { top: top, left: left });
      });
    }
  }]);
  return PhotoBox;
}();

return PhotoBox;

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjpudWxsLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL3Zub2RlLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvb3B0aW9ucy5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL2guanMiLCIuLi9ub2RlX21vZHVsZXMvcHJlYWN0L3NyYy91dGlsLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvY2xvbmUtZWxlbWVudC5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL2NvbnN0YW50cy5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL2xpbmtlZC1zdGF0ZS5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL3JlbmRlci1xdWV1ZS5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL3Zkb20vZnVuY3Rpb25hbC1jb21wb25lbnQuanMiLCIuLi9ub2RlX21vZHVsZXMvcHJlYWN0L3NyYy92ZG9tL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvZG9tL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvZG9tL3JlY3ljbGVyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvdmRvbS9kaWZmLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvdmRvbS9jb21wb25lbnQtcmVjeWNsZXIuanMiLCIuLi9ub2RlX21vZHVsZXMvcHJlYWN0L3NyYy92ZG9tL2NvbXBvbmVudC5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL2NvbXBvbmVudC5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL3JlbmRlci5qcyIsIi4uL3NyYy9FdmVudHMuanMiLCIuLi9zcmMvY29sb3IuanMiLCIuLi9zcmMvU1ZHU3ltYm9scy5qcyIsIi4uL3NyYy9QaG90b0JveFByb2dyZXNzLmpzIiwiLi4vc3JjL0ljb24uanMiLCIuLi9zcmMvd2l0aENTUy5qcyIsIi4uL3NyYy9QaG90b0JveEFjdGlvbkJhci5qcyIsIi4uL3NyYy9QaG90b0JveFN0ZXAxLmpzIiwiLi4vc3JjL1Bob3RvQm94U3RlcDIuanMiLCIuLi9zcmMvUGhvdG9Cb3guanMiLCIuLi9zcmMvUGhvdG9Cb3hUYXJnZXQuanMiLCIuLi9zcmMvaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqIFZpcnR1YWwgRE9NIE5vZGUgKi9cbmV4cG9ydCBmdW5jdGlvbiBWTm9kZShub2RlTmFtZSwgYXR0cmlidXRlcywgY2hpbGRyZW4pIHtcblx0LyoqIEB0eXBlIHtzdHJpbmd8ZnVuY3Rpb259ICovXG5cdHRoaXMubm9kZU5hbWUgPSBub2RlTmFtZTtcblxuXHQvKiogQHR5cGUge29iamVjdDxzdHJpbmc+fHVuZGVmaW5lZH0gKi9cblx0dGhpcy5hdHRyaWJ1dGVzID0gYXR0cmlidXRlcztcblxuXHQvKiogQHR5cGUge2FycmF5PFZOb2RlPnx1bmRlZmluZWR9ICovXG5cdHRoaXMuY2hpbGRyZW4gPSBjaGlsZHJlbjtcblxuXHQvKiogUmVmZXJlbmNlIHRvIHRoZSBnaXZlbiBrZXkuICovXG5cdHRoaXMua2V5ID0gYXR0cmlidXRlcyAmJiBhdHRyaWJ1dGVzLmtleTtcbn1cbiIsIi8qKiBHbG9iYWwgb3B0aW9uc1xuICpcdEBwdWJsaWNcbiAqXHRAbmFtZXNwYWNlIG9wdGlvbnMge09iamVjdH1cbiAqL1xuZXhwb3J0IGRlZmF1bHQge1xuXG5cdC8qKiBJZiBgdHJ1ZWAsIGBwcm9wYCBjaGFuZ2VzIHRyaWdnZXIgc3luY2hyb25vdXMgY29tcG9uZW50IHVwZGF0ZXMuXG5cdCAqXHRAbmFtZSBzeW5jQ29tcG9uZW50VXBkYXRlc1xuXHQgKlx0QHR5cGUgQm9vbGVhblxuXHQgKlx0QGRlZmF1bHQgdHJ1ZVxuXHQgKi9cblx0Ly9zeW5jQ29tcG9uZW50VXBkYXRlczogdHJ1ZSxcblxuXHQvKiogUHJvY2Vzc2VzIGFsbCBjcmVhdGVkIFZOb2Rlcy5cblx0ICpcdEBwYXJhbSB7Vk5vZGV9IHZub2RlXHRBIG5ld2x5LWNyZWF0ZWQgVk5vZGUgdG8gbm9ybWFsaXplL3Byb2Nlc3Ncblx0ICovXG5cdC8vdm5vZGUodm5vZGUpIHsgfVxuXG5cdC8qKiBIb29rIGludm9rZWQgYWZ0ZXIgYSBjb21wb25lbnQgaXMgbW91bnRlZC4gKi9cblx0Ly8gYWZ0ZXJNb3VudChjb21wb25lbnQpIHsgfVxuXG5cdC8qKiBIb29rIGludm9rZWQgYWZ0ZXIgdGhlIERPTSBpcyB1cGRhdGVkIHdpdGggYSBjb21wb25lbnQncyBsYXRlc3QgcmVuZGVyLiAqL1xuXHQvLyBhZnRlclVwZGF0ZShjb21wb25lbnQpIHsgfVxuXG5cdC8qKiBIb29rIGludm9rZWQgaW1tZWRpYXRlbHkgYmVmb3JlIGEgY29tcG9uZW50IGlzIHVubW91bnRlZC4gKi9cblx0Ly8gYmVmb3JlVW5tb3VudChjb21wb25lbnQpIHsgfVxufTtcbiIsImltcG9ydCB7IFZOb2RlIH0gZnJvbSAnLi92bm9kZSc7XG5pbXBvcnQgb3B0aW9ucyBmcm9tICcuL29wdGlvbnMnO1xuXG5cbmNvbnN0IHN0YWNrID0gW107XG5cblxuLyoqIEpTWC9oeXBlcnNjcmlwdCByZXZpdmVyXG4qXHRCZW5jaG1hcmtzOiBodHRwczovL2VzYmVuY2guY29tL2JlbmNoLzU3ZWU4ZjhlMzMwYWIwOTkwMGExYTFhMFxuICpcdEBzZWUgaHR0cDovL2phc29uZm9ybWF0LmNvbS93dGYtaXMtanN4XG4gKlx0QHB1YmxpY1xuICogIEBleGFtcGxlXG4gKiAgLyoqIEBqc3ggaCAqXFwvXG4gKiAgaW1wb3J0IHsgcmVuZGVyLCBoIH0gZnJvbSAncHJlYWN0JztcbiAqICByZW5kZXIoPHNwYW4+Zm9vPC9zcGFuPiwgZG9jdW1lbnQuYm9keSk7XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoKG5vZGVOYW1lLCBhdHRyaWJ1dGVzKSB7XG5cdGxldCBjaGlsZHJlbiA9IFtdLFxuXHRcdGxhc3RTaW1wbGUsIGNoaWxkLCBzaW1wbGUsIGk7XG5cdGZvciAoaT1hcmd1bWVudHMubGVuZ3RoOyBpLS0gPiAyOyApIHtcblx0XHRzdGFjay5wdXNoKGFyZ3VtZW50c1tpXSk7XG5cdH1cblx0aWYgKGF0dHJpYnV0ZXMgJiYgYXR0cmlidXRlcy5jaGlsZHJlbikge1xuXHRcdGlmICghc3RhY2subGVuZ3RoKSBzdGFjay5wdXNoKGF0dHJpYnV0ZXMuY2hpbGRyZW4pO1xuXHRcdGRlbGV0ZSBhdHRyaWJ1dGVzLmNoaWxkcmVuO1xuXHR9XG5cdHdoaWxlIChzdGFjay5sZW5ndGgpIHtcblx0XHRpZiAoKGNoaWxkID0gc3RhY2sucG9wKCkpIGluc3RhbmNlb2YgQXJyYXkpIHtcblx0XHRcdGZvciAoaT1jaGlsZC5sZW5ndGg7IGktLTsgKSBzdGFjay5wdXNoKGNoaWxkW2ldKTtcblx0XHR9XG5cdFx0ZWxzZSBpZiAoY2hpbGQhPW51bGwgJiYgY2hpbGQhPT1mYWxzZSkge1xuXHRcdFx0aWYgKHR5cGVvZiBjaGlsZD09J251bWJlcicgfHwgY2hpbGQ9PT10cnVlKSBjaGlsZCA9IFN0cmluZyhjaGlsZCk7XG5cdFx0XHRzaW1wbGUgPSB0eXBlb2YgY2hpbGQ9PSdzdHJpbmcnO1xuXHRcdFx0aWYgKHNpbXBsZSAmJiBsYXN0U2ltcGxlKSB7XG5cdFx0XHRcdGNoaWxkcmVuW2NoaWxkcmVuLmxlbmd0aC0xXSArPSBjaGlsZDtcblx0XHRcdH1cblx0XHRcdGVsc2Uge1xuXHRcdFx0XHRjaGlsZHJlbi5wdXNoKGNoaWxkKTtcblx0XHRcdFx0bGFzdFNpbXBsZSA9IHNpbXBsZTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRsZXQgcCA9IG5ldyBWTm9kZShub2RlTmFtZSwgYXR0cmlidXRlcyB8fCB1bmRlZmluZWQsIGNoaWxkcmVuKTtcblxuXHQvLyBpZiBhIFwidm5vZGUgaG9va1wiIGlzIGRlZmluZWQsIHBhc3MgZXZlcnkgY3JlYXRlZCBWTm9kZSB0byBpdFxuXHRpZiAob3B0aW9ucy52bm9kZSkgb3B0aW9ucy52bm9kZShwKTtcblxuXHRyZXR1cm4gcDtcbn1cbiIsIi8qKiBDb3B5IG93bi1wcm9wZXJ0aWVzIGZyb20gYHByb3BzYCBvbnRvIGBvYmpgLlxuICpcdEByZXR1cm5zIG9ialxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRlbmQob2JqLCBwcm9wcykge1xuXHRpZiAocHJvcHMpIHtcblx0XHRmb3IgKGxldCBpIGluIHByb3BzKSBvYmpbaV0gPSBwcm9wc1tpXTtcblx0fVxuXHRyZXR1cm4gb2JqO1xufVxuXG5cbi8qKiBGYXN0IGNsb25lLiBOb3RlOiBkb2VzIG5vdCBmaWx0ZXIgb3V0IG5vbi1vd24gcHJvcGVydGllcy5cbiAqXHRAc2VlIGh0dHBzOi8vZXNiZW5jaC5jb20vYmVuY2gvNTZiYWEzNGY0NWRmNjg5NTAwMmUwM2I2XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbG9uZShvYmopIHtcblx0cmV0dXJuIGV4dGVuZCh7fSwgb2JqKTtcbn1cblxuXG4vKiogR2V0IGEgZGVlcCBwcm9wZXJ0eSB2YWx1ZSBmcm9tIHRoZSBnaXZlbiBvYmplY3QsIGV4cHJlc3NlZCBpbiBkb3Qtbm90YXRpb24uXG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlbHZlKG9iaiwga2V5KSB7XG5cdGZvciAobGV0IHA9a2V5LnNwbGl0KCcuJyksIGk9MDsgaTxwLmxlbmd0aCAmJiBvYmo7IGkrKykge1xuXHRcdG9iaiA9IG9ialtwW2ldXTtcblx0fVxuXHRyZXR1cm4gb2JqO1xufVxuXG5cbi8qKiBAcHJpdmF0ZSBpcyB0aGUgZ2l2ZW4gb2JqZWN0IGEgRnVuY3Rpb24/ICovXG5leHBvcnQgZnVuY3Rpb24gaXNGdW5jdGlvbihvYmopIHtcblx0cmV0dXJuICdmdW5jdGlvbic9PT10eXBlb2Ygb2JqO1xufVxuXG5cbi8qKiBAcHJpdmF0ZSBpcyB0aGUgZ2l2ZW4gb2JqZWN0IGEgU3RyaW5nPyAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3RyaW5nKG9iaikge1xuXHRyZXR1cm4gJ3N0cmluZyc9PT10eXBlb2Ygb2JqO1xufVxuXG5cbi8qKiBDb252ZXJ0IGEgaGFzaG1hcCBvZiBDU1MgY2xhc3NlcyB0byBhIHNwYWNlLWRlbGltaXRlZCBjbGFzc05hbWUgc3RyaW5nXG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhhc2hUb0NsYXNzTmFtZShjKSB7XG5cdGxldCBzdHIgPSAnJztcblx0Zm9yIChsZXQgcHJvcCBpbiBjKSB7XG5cdFx0aWYgKGNbcHJvcF0pIHtcblx0XHRcdGlmIChzdHIpIHN0ciArPSAnICc7XG5cdFx0XHRzdHIgKz0gcHJvcDtcblx0XHR9XG5cdH1cblx0cmV0dXJuIHN0cjtcbn1cblxuXG4vKiogSnVzdCBhIG1lbW9pemVkIFN0cmluZyN0b0xvd2VyQ2FzZSAqL1xubGV0IGxjQ2FjaGUgPSB7fTtcbmV4cG9ydCBjb25zdCB0b0xvd2VyQ2FzZSA9IHMgPT4gbGNDYWNoZVtzXSB8fCAobGNDYWNoZVtzXSA9IHMudG9Mb3dlckNhc2UoKSk7XG5cblxuLyoqIENhbGwgYSBmdW5jdGlvbiBhc3luY2hyb25vdXNseSwgYXMgc29vbiBhcyBwb3NzaWJsZS5cbiAqXHRAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICovXG5sZXQgcmVzb2x2ZWQgPSB0eXBlb2YgUHJvbWlzZSE9PSd1bmRlZmluZWQnICYmIFByb21pc2UucmVzb2x2ZSgpO1xuZXhwb3J0IGNvbnN0IGRlZmVyID0gcmVzb2x2ZWQgPyAoZiA9PiB7IHJlc29sdmVkLnRoZW4oZik7IH0pIDogc2V0VGltZW91dDtcbiIsImltcG9ydCB7IGNsb25lLCBleHRlbmQgfSBmcm9tICcuL3V0aWwnO1xuaW1wb3J0IHsgaCB9IGZyb20gJy4vaCc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjbG9uZUVsZW1lbnQodm5vZGUsIHByb3BzKSB7XG5cdHJldHVybiBoKFxuXHRcdHZub2RlLm5vZGVOYW1lLFxuXHRcdGV4dGVuZChjbG9uZSh2bm9kZS5hdHRyaWJ1dGVzKSwgcHJvcHMpLFxuXHRcdGFyZ3VtZW50cy5sZW5ndGg+MiA/IFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKSA6IHZub2RlLmNoaWxkcmVuXG5cdCk7XG59XG4iLCIvLyByZW5kZXIgbW9kZXNcblxuZXhwb3J0IGNvbnN0IE5PX1JFTkRFUiA9IDA7XG5leHBvcnQgY29uc3QgU1lOQ19SRU5ERVIgPSAxO1xuZXhwb3J0IGNvbnN0IEZPUkNFX1JFTkRFUiA9IDI7XG5leHBvcnQgY29uc3QgQVNZTkNfUkVOREVSID0gMztcblxuZXhwb3J0IGNvbnN0IEVNUFRZID0ge307XG5cbmV4cG9ydCBjb25zdCBBVFRSX0tFWSA9IHR5cGVvZiBTeW1ib2whPT0ndW5kZWZpbmVkJyA/IFN5bWJvbC5mb3IoJ3ByZWFjdGF0dHInKSA6ICdfX3ByZWFjdGF0dHJfJztcblxuLy8gRE9NIHByb3BlcnRpZXMgdGhhdCBzaG91bGQgTk9UIGhhdmUgXCJweFwiIGFkZGVkIHdoZW4gbnVtZXJpY1xuZXhwb3J0IGNvbnN0IE5PTl9ESU1FTlNJT05fUFJPUFMgPSB7XG5cdGJveEZsZXg6MSwgYm94RmxleEdyb3VwOjEsIGNvbHVtbkNvdW50OjEsIGZpbGxPcGFjaXR5OjEsIGZsZXg6MSwgZmxleEdyb3c6MSxcblx0ZmxleFBvc2l0aXZlOjEsIGZsZXhTaHJpbms6MSwgZmxleE5lZ2F0aXZlOjEsIGZvbnRXZWlnaHQ6MSwgbGluZUNsYW1wOjEsIGxpbmVIZWlnaHQ6MSxcblx0b3BhY2l0eToxLCBvcmRlcjoxLCBvcnBoYW5zOjEsIHN0cm9rZU9wYWNpdHk6MSwgd2lkb3dzOjEsIHpJbmRleDoxLCB6b29tOjFcbn07XG5cbi8vIERPTSBldmVudCB0eXBlcyB0aGF0IGRvIG5vdCBidWJibGUgYW5kIHNob3VsZCBiZSBhdHRhY2hlZCB2aWEgdXNlQ2FwdHVyZVxuZXhwb3J0IGNvbnN0IE5PTl9CVUJCTElOR19FVkVOVFMgPSB7IGJsdXI6MSwgZXJyb3I6MSwgZm9jdXM6MSwgbG9hZDoxLCByZXNpemU6MSwgc2Nyb2xsOjEgfTtcbiIsImltcG9ydCB7IGlzU3RyaW5nLCBkZWx2ZSB9IGZyb20gJy4vdXRpbCc7XG5cbi8qKiBDcmVhdGUgYW4gRXZlbnQgaGFuZGxlciBmdW5jdGlvbiB0aGF0IHNldHMgYSBnaXZlbiBzdGF0ZSBwcm9wZXJ0eS5cbiAqXHRAcGFyYW0ge0NvbXBvbmVudH0gY29tcG9uZW50XHRUaGUgY29tcG9uZW50IHdob3NlIHN0YXRlIHNob3VsZCBiZSB1cGRhdGVkXG4gKlx0QHBhcmFtIHtzdHJpbmd9IGtleVx0XHRcdFx0QSBkb3Qtbm90YXRlZCBrZXkgcGF0aCB0byB1cGRhdGUgaW4gdGhlIGNvbXBvbmVudCdzIHN0YXRlXG4gKlx0QHBhcmFtIHtzdHJpbmd9IGV2ZW50UGF0aFx0XHRBIGRvdC1ub3RhdGVkIGtleSBwYXRoIHRvIHRoZSB2YWx1ZSB0aGF0IHNob3VsZCBiZSByZXRyaWV2ZWQgZnJvbSB0aGUgRXZlbnQgb3IgY29tcG9uZW50XG4gKlx0QHJldHVybnMge2Z1bmN0aW9ufSBsaW5rZWRTdGF0ZUhhbmRsZXJcbiAqXHRAcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTGlua2VkU3RhdGUoY29tcG9uZW50LCBrZXksIGV2ZW50UGF0aCkge1xuXHRsZXQgcGF0aCA9IGtleS5zcGxpdCgnLicpO1xuXHRyZXR1cm4gZnVuY3Rpb24oZSkge1xuXHRcdGxldCB0ID0gZSAmJiBlLnRhcmdldCB8fCB0aGlzLFxuXHRcdFx0c3RhdGUgPSB7fSxcblx0XHRcdG9iaiA9IHN0YXRlLFxuXHRcdFx0diA9IGlzU3RyaW5nKGV2ZW50UGF0aCkgPyBkZWx2ZShlLCBldmVudFBhdGgpIDogdC5ub2RlTmFtZSA/ICh0LnR5cGUubWF0Y2goL15jaGV8cmFkLykgPyB0LmNoZWNrZWQgOiB0LnZhbHVlKSA6IGUsXG5cdFx0XHRpID0gMDtcblx0XHRmb3IgKCA7IGk8cGF0aC5sZW5ndGgtMTsgaSsrKSB7XG5cdFx0XHRvYmogPSBvYmpbcGF0aFtpXV0gfHwgKG9ialtwYXRoW2ldXSA9ICFpICYmIGNvbXBvbmVudC5zdGF0ZVtwYXRoW2ldXSB8fCB7fSk7XG5cdFx0fVxuXHRcdG9ialtwYXRoW2ldXSA9IHY7XG5cdFx0Y29tcG9uZW50LnNldFN0YXRlKHN0YXRlKTtcblx0fTtcbn1cbiIsImltcG9ydCBvcHRpb25zIGZyb20gJy4vb3B0aW9ucyc7XG5pbXBvcnQgeyBkZWZlciB9IGZyb20gJy4vdXRpbCc7XG5pbXBvcnQgeyByZW5kZXJDb21wb25lbnQgfSBmcm9tICcuL3Zkb20vY29tcG9uZW50JztcblxuLyoqIE1hbmFnZWQgcXVldWUgb2YgZGlydHkgY29tcG9uZW50cyB0byBiZSByZS1yZW5kZXJlZCAqL1xuXG4vLyBpdGVtcy9pdGVtc09mZmxpbmUgc3dhcCBvbiBlYWNoIHJlcmVuZGVyKCkgY2FsbCAoanVzdCBhIHNpbXBsZSBwb29sIHRlY2huaXF1ZSlcbmxldCBpdGVtcyA9IFtdO1xuXG5leHBvcnQgZnVuY3Rpb24gZW5xdWV1ZVJlbmRlcihjb21wb25lbnQpIHtcblx0aWYgKCFjb21wb25lbnQuX2RpcnR5ICYmIChjb21wb25lbnQuX2RpcnR5ID0gdHJ1ZSkgJiYgaXRlbXMucHVzaChjb21wb25lbnQpPT0xKSB7XG5cdFx0KG9wdGlvbnMuZGVib3VuY2VSZW5kZXJpbmcgfHwgZGVmZXIpKHJlcmVuZGVyKTtcblx0fVxufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiByZXJlbmRlcigpIHtcblx0bGV0IHAsIGxpc3QgPSBpdGVtcztcblx0aXRlbXMgPSBbXTtcblx0d2hpbGUgKCAocCA9IGxpc3QucG9wKCkpICkge1xuXHRcdGlmIChwLl9kaXJ0eSkgcmVuZGVyQ29tcG9uZW50KHApO1xuXHR9XG59XG4iLCJpbXBvcnQgeyBFTVBUWSB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgeyBnZXROb2RlUHJvcHMgfSBmcm9tICcuL2luZGV4JztcbmltcG9ydCB7IGlzRnVuY3Rpb24gfSBmcm9tICcuLi91dGlsJztcblxuXG4vKiogQ2hlY2sgaWYgYSBWTm9kZSBpcyBhIHJlZmVyZW5jZSB0byBhIHN0YXRlbGVzcyBmdW5jdGlvbmFsIGNvbXBvbmVudC5cbiAqXHRBIGZ1bmN0aW9uIGNvbXBvbmVudCBpcyByZXByZXNlbnRlZCBhcyBhIFZOb2RlIHdob3NlIGBub2RlTmFtZWAgcHJvcGVydHkgaXMgYSByZWZlcmVuY2UgdG8gYSBmdW5jdGlvbi5cbiAqXHRJZiB0aGF0IGZ1bmN0aW9uIGlzIG5vdCBhIENvbXBvbmVudCAoaWUsIGhhcyBubyBgLnJlbmRlcigpYCBtZXRob2Qgb24gYSBwcm90b3R5cGUpLCBpdCBpcyBjb25zaWRlcmVkIGEgc3RhdGVsZXNzIGZ1bmN0aW9uYWwgY29tcG9uZW50LlxuICpcdEBwYXJhbSB7Vk5vZGV9IHZub2RlXHRBIFZOb2RlXG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRnVuY3Rpb25hbENvbXBvbmVudCh2bm9kZSkge1xuXHRsZXQgbm9kZU5hbWUgPSB2bm9kZSAmJiB2bm9kZS5ub2RlTmFtZTtcblx0cmV0dXJuIG5vZGVOYW1lICYmIGlzRnVuY3Rpb24obm9kZU5hbWUpICYmICEobm9kZU5hbWUucHJvdG90eXBlICYmIG5vZGVOYW1lLnByb3RvdHlwZS5yZW5kZXIpO1xufVxuXG5cblxuLyoqIENvbnN0cnVjdCBhIHJlc3VsdGFudCBWTm9kZSBmcm9tIGEgVk5vZGUgcmVmZXJlbmNpbmcgYSBzdGF0ZWxlc3MgZnVuY3Rpb25hbCBjb21wb25lbnQuXG4gKlx0QHBhcmFtIHtWTm9kZX0gdm5vZGVcdEEgVk5vZGUgd2l0aCBhIGBub2RlTmFtZWAgcHJvcGVydHkgdGhhdCBpcyBhIHJlZmVyZW5jZSB0byBhIGZ1bmN0aW9uLlxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEZ1bmN0aW9uYWxDb21wb25lbnQodm5vZGUsIGNvbnRleHQpIHtcblx0cmV0dXJuIHZub2RlLm5vZGVOYW1lKGdldE5vZGVQcm9wcyh2bm9kZSksIGNvbnRleHQgfHwgRU1QVFkpO1xufVxuIiwiaW1wb3J0IHsgY2xvbmUsIGlzU3RyaW5nLCBpc0Z1bmN0aW9uLCB0b0xvd2VyQ2FzZSB9IGZyb20gJy4uL3V0aWwnO1xuaW1wb3J0IHsgaXNGdW5jdGlvbmFsQ29tcG9uZW50IH0gZnJvbSAnLi9mdW5jdGlvbmFsLWNvbXBvbmVudCc7XG5cblxuLyoqIENoZWNrIGlmIHR3byBub2RlcyBhcmUgZXF1aXZhbGVudC5cbiAqXHRAcGFyYW0ge0VsZW1lbnR9IG5vZGVcbiAqXHRAcGFyYW0ge1ZOb2RlfSB2bm9kZVxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NhbWVOb2RlVHlwZShub2RlLCB2bm9kZSkge1xuXHRpZiAoaXNTdHJpbmcodm5vZGUpKSB7XG5cdFx0cmV0dXJuIG5vZGUgaW5zdGFuY2VvZiBUZXh0O1xuXHR9XG5cdGlmIChpc1N0cmluZyh2bm9kZS5ub2RlTmFtZSkpIHtcblx0XHRyZXR1cm4gIW5vZGUuX2NvbXBvbmVudENvbnN0cnVjdG9yICYmIGlzTmFtZWROb2RlKG5vZGUsIHZub2RlLm5vZGVOYW1lKTtcblx0fVxuXHRpZiAoaXNGdW5jdGlvbih2bm9kZS5ub2RlTmFtZSkpIHtcblx0XHRyZXR1cm4gKG5vZGUuX2NvbXBvbmVudENvbnN0cnVjdG9yID8gbm9kZS5fY29tcG9uZW50Q29uc3RydWN0b3I9PT12bm9kZS5ub2RlTmFtZSA6IHRydWUpIHx8IGlzRnVuY3Rpb25hbENvbXBvbmVudCh2bm9kZSk7XG5cdH1cbn1cblxuXG5leHBvcnQgZnVuY3Rpb24gaXNOYW1lZE5vZGUobm9kZSwgbm9kZU5hbWUpIHtcblx0cmV0dXJuIG5vZGUubm9ybWFsaXplZE5vZGVOYW1lPT09bm9kZU5hbWUgfHwgdG9Mb3dlckNhc2Uobm9kZS5ub2RlTmFtZSk9PT10b0xvd2VyQ2FzZShub2RlTmFtZSk7XG59XG5cblxuLyoqXG4gKiBSZWNvbnN0cnVjdCBDb21wb25lbnQtc3R5bGUgYHByb3BzYCBmcm9tIGEgVk5vZGUuXG4gKiBFbnN1cmVzIGRlZmF1bHQvZmFsbGJhY2sgdmFsdWVzIGZyb20gYGRlZmF1bHRQcm9wc2A6XG4gKiBPd24tcHJvcGVydGllcyBvZiBgZGVmYXVsdFByb3BzYCBub3QgcHJlc2VudCBpbiBgdm5vZGUuYXR0cmlidXRlc2AgYXJlIGFkZGVkLlxuICogQHBhcmFtIHtWTm9kZX0gdm5vZGVcbiAqIEByZXR1cm5zIHtPYmplY3R9IHByb3BzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXROb2RlUHJvcHModm5vZGUpIHtcblx0bGV0IHByb3BzID0gY2xvbmUodm5vZGUuYXR0cmlidXRlcyk7XG5cdHByb3BzLmNoaWxkcmVuID0gdm5vZGUuY2hpbGRyZW47XG5cblx0bGV0IGRlZmF1bHRQcm9wcyA9IHZub2RlLm5vZGVOYW1lLmRlZmF1bHRQcm9wcztcblx0aWYgKGRlZmF1bHRQcm9wcykge1xuXHRcdGZvciAobGV0IGkgaW4gZGVmYXVsdFByb3BzKSB7XG5cdFx0XHRpZiAocHJvcHNbaV09PT11bmRlZmluZWQpIHtcblx0XHRcdFx0cHJvcHNbaV0gPSBkZWZhdWx0UHJvcHNbaV07XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHByb3BzO1xufVxuIiwiaW1wb3J0IHsgTk9OX0RJTUVOU0lPTl9QUk9QUywgTk9OX0JVQkJMSU5HX0VWRU5UUyB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgb3B0aW9ucyBmcm9tICcuLi9vcHRpb25zJztcbmltcG9ydCB7IHRvTG93ZXJDYXNlLCBpc1N0cmluZywgaXNGdW5jdGlvbiwgaGFzaFRvQ2xhc3NOYW1lIH0gZnJvbSAnLi4vdXRpbCc7XG5cblxuXG5cbi8qKiBSZW1vdmVzIGEgZ2l2ZW4gRE9NIE5vZGUgZnJvbSBpdHMgcGFyZW50LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZU5vZGUobm9kZSkge1xuXHRsZXQgcCA9IG5vZGUucGFyZW50Tm9kZTtcblx0aWYgKHApIHAucmVtb3ZlQ2hpbGQobm9kZSk7XG59XG5cblxuLyoqIFNldCBhIG5hbWVkIGF0dHJpYnV0ZSBvbiB0aGUgZ2l2ZW4gTm9kZSwgd2l0aCBzcGVjaWFsIGJlaGF2aW9yIGZvciBzb21lIG5hbWVzIGFuZCBldmVudCBoYW5kbGVycy5cbiAqXHRJZiBgdmFsdWVgIGlzIGBudWxsYCwgdGhlIGF0dHJpYnV0ZS9oYW5kbGVyIHdpbGwgYmUgcmVtb3ZlZC5cbiAqXHRAcGFyYW0ge0VsZW1lbnR9IG5vZGVcdEFuIGVsZW1lbnQgdG8gbXV0YXRlXG4gKlx0QHBhcmFtIHtzdHJpbmd9IG5hbWVcdFRoZSBuYW1lL2tleSB0byBzZXQsIHN1Y2ggYXMgYW4gZXZlbnQgb3IgYXR0cmlidXRlIG5hbWVcbiAqXHRAcGFyYW0ge2FueX0gdmFsdWVcdFx0QW4gYXR0cmlidXRlIHZhbHVlLCBzdWNoIGFzIGEgZnVuY3Rpb24gdG8gYmUgdXNlZCBhcyBhbiBldmVudCBoYW5kbGVyXG4gKlx0QHBhcmFtIHthbnl9IHByZXZpb3VzVmFsdWVcdFRoZSBsYXN0IHZhbHVlIHRoYXQgd2FzIHNldCBmb3IgdGhpcyBuYW1lL25vZGUgcGFpclxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRBY2Nlc3Nvcihub2RlLCBuYW1lLCBvbGQsIHZhbHVlLCBpc1N2Zykge1xuXG5cdGlmIChuYW1lPT09J2NsYXNzTmFtZScpIG5hbWUgPSAnY2xhc3MnO1xuXG5cdGlmIChuYW1lPT09J2NsYXNzJyAmJiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWU9PT0nb2JqZWN0Jykge1xuXHRcdHZhbHVlID0gaGFzaFRvQ2xhc3NOYW1lKHZhbHVlKTtcblx0fVxuXG5cdGlmIChuYW1lPT09J2tleScpIHtcblx0XHQvLyBpZ25vcmVcblx0fVxuXHRlbHNlIGlmIChuYW1lPT09J2NsYXNzJyAmJiAhaXNTdmcpIHtcblx0XHRub2RlLmNsYXNzTmFtZSA9IHZhbHVlIHx8ICcnO1xuXHR9XG5cdGVsc2UgaWYgKG5hbWU9PT0nc3R5bGUnKSB7XG5cdFx0aWYgKCF2YWx1ZSB8fCBpc1N0cmluZyh2YWx1ZSkgfHwgaXNTdHJpbmcob2xkKSkge1xuXHRcdFx0bm9kZS5zdHlsZS5jc3NUZXh0ID0gdmFsdWUgfHwgJyc7XG5cdFx0fVxuXHRcdGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWU9PT0nb2JqZWN0Jykge1xuXHRcdFx0aWYgKCFpc1N0cmluZyhvbGQpKSB7XG5cdFx0XHRcdGZvciAobGV0IGkgaW4gb2xkKSBpZiAoIShpIGluIHZhbHVlKSkgbm9kZS5zdHlsZVtpXSA9ICcnO1xuXHRcdFx0fVxuXHRcdFx0Zm9yIChsZXQgaSBpbiB2YWx1ZSkge1xuXHRcdFx0XHRub2RlLnN0eWxlW2ldID0gdHlwZW9mIHZhbHVlW2ldPT09J251bWJlcicgJiYgIU5PTl9ESU1FTlNJT05fUFJPUFNbaV0gPyAodmFsdWVbaV0rJ3B4JykgOiB2YWx1ZVtpXTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblx0ZWxzZSBpZiAobmFtZT09PSdkYW5nZXJvdXNseVNldElubmVySFRNTCcpIHtcblx0XHRub2RlLmlubmVySFRNTCA9IHZhbHVlICYmIHZhbHVlLl9faHRtbCB8fCAnJztcblx0fVxuXHRlbHNlIGlmIChuYW1lWzBdPT0nbycgJiYgbmFtZVsxXT09J24nKSB7XG5cdFx0bGV0IGwgPSBub2RlLl9saXN0ZW5lcnMgfHwgKG5vZGUuX2xpc3RlbmVycyA9IHt9KTtcblx0XHRuYW1lID0gdG9Mb3dlckNhc2UobmFtZS5zdWJzdHJpbmcoMikpO1xuXHRcdC8vIEBUT0RPOiB0aGlzIG1pZ2h0IGJlIHdvcnRoIGl0IGxhdGVyLCB1bi1icmVha3MgZm9jdXMvYmx1ciBidWJibGluZyBpbiBJRTk6XG5cdFx0Ly8gaWYgKG5vZGUuYXR0YWNoRXZlbnQpIG5hbWUgPSBuYW1lPT0nZm9jdXMnPydmb2N1c2luJzpuYW1lPT0nYmx1cic/J2ZvY3Vzb3V0JzpuYW1lO1xuXHRcdGlmICh2YWx1ZSkge1xuXHRcdFx0aWYgKCFsW25hbWVdKSBub2RlLmFkZEV2ZW50TGlzdGVuZXIobmFtZSwgZXZlbnRQcm94eSwgISFOT05fQlVCQkxJTkdfRVZFTlRTW25hbWVdKTtcblx0XHR9XG5cdFx0ZWxzZSBpZiAobFtuYW1lXSkge1xuXHRcdFx0bm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKG5hbWUsIGV2ZW50UHJveHksICEhTk9OX0JVQkJMSU5HX0VWRU5UU1tuYW1lXSk7XG5cdFx0fVxuXHRcdGxbbmFtZV0gPSB2YWx1ZTtcblx0fVxuXHRlbHNlIGlmIChuYW1lIT09J2xpc3QnICYmIG5hbWUhPT0ndHlwZScgJiYgIWlzU3ZnICYmIG5hbWUgaW4gbm9kZSkge1xuXHRcdHNldFByb3BlcnR5KG5vZGUsIG5hbWUsIHZhbHVlPT1udWxsID8gJycgOiB2YWx1ZSk7XG5cdFx0aWYgKHZhbHVlPT1udWxsIHx8IHZhbHVlPT09ZmFsc2UpIG5vZGUucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuXHR9XG5cdGVsc2Uge1xuXHRcdGxldCBucyA9IGlzU3ZnICYmIG5hbWUubWF0Y2goL154bGlua1xcOj8oLispLyk7XG5cdFx0aWYgKHZhbHVlPT1udWxsIHx8IHZhbHVlPT09ZmFsc2UpIHtcblx0XHRcdGlmIChucykgbm9kZS5yZW1vdmVBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIHRvTG93ZXJDYXNlKG5zWzFdKSk7XG5cdFx0XHRlbHNlIG5vZGUucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuXHRcdH1cblx0XHRlbHNlIGlmICh0eXBlb2YgdmFsdWUhPT0nb2JqZWN0JyAmJiAhaXNGdW5jdGlvbih2YWx1ZSkpIHtcblx0XHRcdGlmIChucykgbm9kZS5zZXRBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIHRvTG93ZXJDYXNlKG5zWzFdKSwgdmFsdWUpO1xuXHRcdFx0ZWxzZSBub2RlLnNldEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSk7XG5cdFx0fVxuXHR9XG59XG5cblxuLyoqIEF0dGVtcHQgdG8gc2V0IGEgRE9NIHByb3BlcnR5IHRvIHRoZSBnaXZlbiB2YWx1ZS5cbiAqXHRJRSAmIEZGIHRocm93IGZvciBjZXJ0YWluIHByb3BlcnR5LXZhbHVlIGNvbWJpbmF0aW9ucy5cbiAqL1xuZnVuY3Rpb24gc2V0UHJvcGVydHkobm9kZSwgbmFtZSwgdmFsdWUpIHtcblx0dHJ5IHtcblx0XHRub2RlW25hbWVdID0gdmFsdWU7XG5cdH0gY2F0Y2ggKGUpIHsgfVxufVxuXG5cbi8qKiBQcm94eSBhbiBldmVudCB0byBob29rZWQgZXZlbnQgaGFuZGxlcnNcbiAqXHRAcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBldmVudFByb3h5KGUpIHtcblx0cmV0dXJuIHRoaXMuX2xpc3RlbmVyc1tlLnR5cGVdKG9wdGlvbnMuZXZlbnQgJiYgb3B0aW9ucy5ldmVudChlKSB8fCBlKTtcbn1cbiIsImltcG9ydCB7IHRvTG93ZXJDYXNlIH0gZnJvbSAnLi4vdXRpbCc7XG5pbXBvcnQgeyByZW1vdmVOb2RlIH0gZnJvbSAnLi9pbmRleCc7XG5cbi8qKiBET00gbm9kZSBwb29sLCBrZXllZCBvbiBub2RlTmFtZS4gKi9cblxuY29uc3Qgbm9kZXMgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3ROb2RlKG5vZGUpIHtcblx0cmVtb3ZlTm9kZShub2RlKTtcblxuXHRpZiAobm9kZSBpbnN0YW5jZW9mIEVsZW1lbnQpIHtcblx0XHRub2RlLl9jb21wb25lbnQgPSBub2RlLl9jb21wb25lbnRDb25zdHJ1Y3RvciA9IG51bGw7XG5cblx0XHRsZXQgbmFtZSA9IG5vZGUubm9ybWFsaXplZE5vZGVOYW1lIHx8IHRvTG93ZXJDYXNlKG5vZGUubm9kZU5hbWUpO1xuXHRcdChub2Rlc1tuYW1lXSB8fCAobm9kZXNbbmFtZV0gPSBbXSkpLnB1c2gobm9kZSk7XG5cdH1cbn1cblxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTm9kZShub2RlTmFtZSwgaXNTdmcpIHtcblx0bGV0IG5hbWUgPSB0b0xvd2VyQ2FzZShub2RlTmFtZSksXG5cdFx0bm9kZSA9IG5vZGVzW25hbWVdICYmIG5vZGVzW25hbWVdLnBvcCgpIHx8IChpc1N2ZyA/IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUygnaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLCBub2RlTmFtZSkgOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KG5vZGVOYW1lKSk7XG5cdG5vZGUubm9ybWFsaXplZE5vZGVOYW1lID0gbmFtZTtcblx0cmV0dXJuIG5vZGU7XG59XG4iLCJpbXBvcnQgeyBBVFRSX0tFWSB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgeyBpc1N0cmluZywgaXNGdW5jdGlvbiB9IGZyb20gJy4uL3V0aWwnO1xuaW1wb3J0IHsgaXNTYW1lTm9kZVR5cGUsIGlzTmFtZWROb2RlIH0gZnJvbSAnLi9pbmRleCc7XG5pbXBvcnQgeyBpc0Z1bmN0aW9uYWxDb21wb25lbnQsIGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudCB9IGZyb20gJy4vZnVuY3Rpb25hbC1jb21wb25lbnQnO1xuaW1wb3J0IHsgYnVpbGRDb21wb25lbnRGcm9tVk5vZGUgfSBmcm9tICcuL2NvbXBvbmVudCc7XG5pbXBvcnQgeyBzZXRBY2Nlc3NvciwgcmVtb3ZlTm9kZSB9IGZyb20gJy4uL2RvbS9pbmRleCc7XG5pbXBvcnQgeyBjcmVhdGVOb2RlLCBjb2xsZWN0Tm9kZSB9IGZyb20gJy4uL2RvbS9yZWN5Y2xlcic7XG5pbXBvcnQgeyB1bm1vdW50Q29tcG9uZW50IH0gZnJvbSAnLi9jb21wb25lbnQnO1xuaW1wb3J0IG9wdGlvbnMgZnJvbSAnLi4vb3B0aW9ucyc7XG5cblxuLyoqIFF1ZXVlIG9mIGNvbXBvbmVudHMgdGhhdCBoYXZlIGJlZW4gbW91bnRlZCBhbmQgYXJlIGF3YWl0aW5nIGNvbXBvbmVudERpZE1vdW50ICovXG5leHBvcnQgY29uc3QgbW91bnRzID0gW107XG5cbi8qKiBEaWZmIHJlY3Vyc2lvbiBjb3VudCwgdXNlZCB0byB0cmFjayB0aGUgZW5kIG9mIHRoZSBkaWZmIGN5Y2xlLiAqL1xuZXhwb3J0IGxldCBkaWZmTGV2ZWwgPSAwO1xuXG4vKiogR2xvYmFsIGZsYWcgaW5kaWNhdGluZyBpZiB0aGUgZGlmZiBpcyBjdXJyZW50bHkgd2l0aGluIGFuIFNWRyAqL1xubGV0IGlzU3ZnTW9kZSA9IGZhbHNlO1xuXG4vKiogR2xvYmFsIGZsYWcgaW5kaWNhdGluZyBpZiB0aGUgZGlmZiBpcyBwZXJmb3JtaW5nIGh5ZHJhdGlvbiAqL1xubGV0IGh5ZHJhdGluZyA9IGZhbHNlO1xuXG5cbi8qKiBJbnZva2UgcXVldWVkIGNvbXBvbmVudERpZE1vdW50IGxpZmVjeWNsZSBtZXRob2RzICovXG5leHBvcnQgZnVuY3Rpb24gZmx1c2hNb3VudHMoKSB7XG5cdGxldCBjO1xuXHR3aGlsZSAoKGM9bW91bnRzLnBvcCgpKSkge1xuXHRcdGlmIChvcHRpb25zLmFmdGVyTW91bnQpIG9wdGlvbnMuYWZ0ZXJNb3VudChjKTtcblx0XHRpZiAoYy5jb21wb25lbnREaWRNb3VudCkgYy5jb21wb25lbnREaWRNb3VudCgpO1xuXHR9XG59XG5cblxuLyoqIEFwcGx5IGRpZmZlcmVuY2VzIGluIGEgZ2l2ZW4gdm5vZGUgKGFuZCBpdCdzIGRlZXAgY2hpbGRyZW4pIHRvIGEgcmVhbCBET00gTm9kZS5cbiAqXHRAcGFyYW0ge0VsZW1lbnR9IFtkb209bnVsbF1cdFx0QSBET00gbm9kZSB0byBtdXRhdGUgaW50byB0aGUgc2hhcGUgb2YgdGhlIGB2bm9kZWBcbiAqXHRAcGFyYW0ge1ZOb2RlfSB2bm9kZVx0XHRcdEEgVk5vZGUgKHdpdGggZGVzY2VuZGFudHMgZm9ybWluZyBhIHRyZWUpIHJlcHJlc2VudGluZyB0aGUgZGVzaXJlZCBET00gc3RydWN0dXJlXG4gKlx0QHJldHVybnMge0VsZW1lbnR9IGRvbVx0XHRcdFRoZSBjcmVhdGVkL211dGF0ZWQgZWxlbWVudFxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaWZmKGRvbSwgdm5vZGUsIGNvbnRleHQsIG1vdW50QWxsLCBwYXJlbnQsIGNvbXBvbmVudFJvb3QpIHtcblx0Ly8gZGlmZkxldmVsIGhhdmluZyBiZWVuIDAgaGVyZSBpbmRpY2F0ZXMgaW5pdGlhbCBlbnRyeSBpbnRvIHRoZSBkaWZmIChub3QgYSBzdWJkaWZmKVxuXHRpZiAoIWRpZmZMZXZlbCsrKSB7XG5cdFx0Ly8gd2hlbiBmaXJzdCBzdGFydGluZyB0aGUgZGlmZiwgY2hlY2sgaWYgd2UncmUgZGlmZmluZyBhbiBTVkcgb3Igd2l0aGluIGFuIFNWR1xuXHRcdGlzU3ZnTW9kZSA9IHBhcmVudCBpbnN0YW5jZW9mIFNWR0VsZW1lbnQ7XG5cblx0XHQvLyBoeWRyYXRpb24gaXMgaW5pZGljYXRlZCBieSB0aGUgZXhpc3RpbmcgZWxlbWVudCB0byBiZSBkaWZmZWQgbm90IGhhdmluZyBhIHByb3AgY2FjaGVcblx0XHRoeWRyYXRpbmcgPSBkb20gJiYgIShBVFRSX0tFWSBpbiBkb20pO1xuXHR9XG5cblx0bGV0IHJldCA9IGlkaWZmKGRvbSwgdm5vZGUsIGNvbnRleHQsIG1vdW50QWxsKTtcblxuXHQvLyBhcHBlbmQgdGhlIGVsZW1lbnQgaWYgaXRzIGEgbmV3IHBhcmVudFxuXHRpZiAocGFyZW50ICYmIHJldC5wYXJlbnROb2RlIT09cGFyZW50KSBwYXJlbnQuYXBwZW5kQ2hpbGQocmV0KTtcblxuXHQvLyBkaWZmTGV2ZWwgYmVpbmcgcmVkdWNlZCB0byAwIG1lYW5zIHdlJ3JlIGV4aXRpbmcgdGhlIGRpZmZcblx0aWYgKCEtLWRpZmZMZXZlbCkge1xuXHRcdGh5ZHJhdGluZyA9IGZhbHNlO1xuXHRcdC8vIGludm9rZSBxdWV1ZWQgY29tcG9uZW50RGlkTW91bnQgbGlmZWN5Y2xlIG1ldGhvZHNcblx0XHRpZiAoIWNvbXBvbmVudFJvb3QpIGZsdXNoTW91bnRzKCk7XG5cdH1cblxuXHRyZXR1cm4gcmV0O1xufVxuXG5cbmZ1bmN0aW9uIGlkaWZmKGRvbSwgdm5vZGUsIGNvbnRleHQsIG1vdW50QWxsKSB7XG5cdGxldCBvcmlnaW5hbEF0dHJpYnV0ZXMgPSB2bm9kZSAmJiB2bm9kZS5hdHRyaWJ1dGVzO1xuXG5cblx0Ly8gUmVzb2x2ZSBlcGhlbWVyYWwgUHVyZSBGdW5jdGlvbmFsIENvbXBvbmVudHNcblx0d2hpbGUgKGlzRnVuY3Rpb25hbENvbXBvbmVudCh2bm9kZSkpIHtcblx0XHR2bm9kZSA9IGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudCh2bm9kZSwgY29udGV4dCk7XG5cdH1cblxuXG5cdC8vIGVtcHR5IHZhbHVlcyAobnVsbCAmIHVuZGVmaW5lZCkgcmVuZGVyIGFzIGVtcHR5IFRleHQgbm9kZXNcblx0aWYgKHZub2RlPT1udWxsKSB2bm9kZSA9ICcnO1xuXG5cblx0Ly8gRmFzdCBjYXNlOiBTdHJpbmdzIGNyZWF0ZS91cGRhdGUgVGV4dCBub2Rlcy5cblx0aWYgKGlzU3RyaW5nKHZub2RlKSkge1xuXHRcdC8vIHVwZGF0ZSBpZiBpdCdzIGFscmVhZHkgYSBUZXh0IG5vZGVcblx0XHRpZiAoZG9tICYmIGRvbSBpbnN0YW5jZW9mIFRleHQpIHtcblx0XHRcdGlmIChkb20ubm9kZVZhbHVlIT12bm9kZSkge1xuXHRcdFx0XHRkb20ubm9kZVZhbHVlID0gdm5vZGU7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGVsc2Uge1xuXHRcdFx0Ly8gaXQgd2Fzbid0IGEgVGV4dCBub2RlOiByZXBsYWNlIGl0IHdpdGggb25lIGFuZCByZWN5Y2xlIHRoZSBvbGQgRWxlbWVudFxuXHRcdFx0aWYgKGRvbSkgcmVjb2xsZWN0Tm9kZVRyZWUoZG9tKTtcblx0XHRcdGRvbSA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHZub2RlKTtcblx0XHR9XG5cblx0XHQvLyBNYXJrIGZvciBub24taHlkcmF0aW9uIHVwZGF0ZXNcblx0XHRkb21bQVRUUl9LRVldID0gdHJ1ZTtcblx0XHRyZXR1cm4gZG9tO1xuXHR9XG5cblxuXHQvLyBJZiB0aGUgVk5vZGUgcmVwcmVzZW50cyBhIENvbXBvbmVudCwgcGVyZm9ybSBhIGNvbXBvbmVudCBkaWZmLlxuXHRpZiAoaXNGdW5jdGlvbih2bm9kZS5ub2RlTmFtZSkpIHtcblx0XHRyZXR1cm4gYnVpbGRDb21wb25lbnRGcm9tVk5vZGUoZG9tLCB2bm9kZSwgY29udGV4dCwgbW91bnRBbGwpO1xuXHR9XG5cblxuXHRsZXQgb3V0ID0gZG9tLFxuXHRcdG5vZGVOYW1lID0gU3RyaW5nKHZub2RlLm5vZGVOYW1lKSxcdC8vIEBUT0RPIHRoaXMgbWFza3MgdW5kZWZpbmVkIGNvbXBvbmVudCBlcnJvcnMgYXMgYDx1bmRlZmluZWQ+YFxuXHRcdHByZXZTdmdNb2RlID0gaXNTdmdNb2RlLFxuXHRcdHZjaGlsZHJlbiA9IHZub2RlLmNoaWxkcmVuO1xuXG5cblx0Ly8gU1ZHcyBoYXZlIHNwZWNpYWwgbmFtZXNwYWNlIHN0dWZmLlxuXHQvLyBUaGlzIHRyYWNrcyBlbnRlcmluZyBhbmQgZXhpdGluZyB0aGF0IG5hbWVzcGFjZSB3aGVuIGRlc2NlbmRpbmcgdGhyb3VnaCB0aGUgdHJlZS5cblx0aXNTdmdNb2RlID0gbm9kZU5hbWU9PT0nc3ZnJyA/IHRydWUgOiBub2RlTmFtZT09PSdmb3JlaWduT2JqZWN0JyA/IGZhbHNlIDogaXNTdmdNb2RlO1xuXG5cblx0aWYgKCFkb20pIHtcblx0XHQvLyBjYXNlOiB3ZSBoYWQgbm8gZWxlbWVudCB0byBiZWdpbiB3aXRoXG5cdFx0Ly8gLSBjcmVhdGUgYW4gZWxlbWVudCB0byB3aXRoIHRoZSBub2RlTmFtZSBmcm9tIFZOb2RlXG5cdFx0b3V0ID0gY3JlYXRlTm9kZShub2RlTmFtZSwgaXNTdmdNb2RlKTtcblx0fVxuXHRlbHNlIGlmICghaXNOYW1lZE5vZGUoZG9tLCBub2RlTmFtZSkpIHtcblx0XHQvLyBjYXNlOiBFbGVtZW50IGFuZCBWTm9kZSBoYWQgZGlmZmVyZW50IG5vZGVOYW1lc1xuXHRcdC8vIC0gbmVlZCB0byBjcmVhdGUgdGhlIGNvcnJlY3QgRWxlbWVudCB0byBtYXRjaCBWTm9kZVxuXHRcdC8vIC0gdGhlbiBtaWdyYXRlIGNoaWxkcmVuIGZyb20gb2xkIHRvIG5ld1xuXG5cdFx0b3V0ID0gY3JlYXRlTm9kZShub2RlTmFtZSwgaXNTdmdNb2RlKTtcblxuXHRcdC8vIG1vdmUgY2hpbGRyZW4gaW50byB0aGUgcmVwbGFjZW1lbnQgbm9kZVxuXHRcdHdoaWxlIChkb20uZmlyc3RDaGlsZCkgb3V0LmFwcGVuZENoaWxkKGRvbS5maXJzdENoaWxkKTtcblxuXHRcdC8vIGlmIHRoZSBwcmV2aW91cyBFbGVtZW50IHdhcyBtb3VudGVkIGludG8gdGhlIERPTSwgcmVwbGFjZSBpdCBpbmxpbmVcblx0XHRpZiAoZG9tLnBhcmVudE5vZGUpIGRvbS5wYXJlbnROb2RlLnJlcGxhY2VDaGlsZChvdXQsIGRvbSk7XG5cblx0XHQvLyByZWN5Y2xlIHRoZSBvbGQgZWxlbWVudCAoc2tpcHMgbm9uLUVsZW1lbnQgbm9kZSB0eXBlcylcblx0XHRyZWNvbGxlY3ROb2RlVHJlZShkb20pO1xuXHR9XG5cblxuXHRsZXQgZmMgPSBvdXQuZmlyc3RDaGlsZCxcblx0XHRwcm9wcyA9IG91dFtBVFRSX0tFWV07XG5cblx0Ly8gQXR0cmlidXRlIEh5ZHJhdGlvbjogaWYgdGhlcmUgaXMgbm8gcHJvcCBjYWNoZSBvbiB0aGUgZWxlbWVudCxcblx0Ly8gLi4uY3JlYXRlIGl0IGFuZCBwb3B1bGF0ZSBpdCB3aXRoIHRoZSBlbGVtZW50J3MgYXR0cmlidXRlcy5cblx0aWYgKCFwcm9wcykge1xuXHRcdG91dFtBVFRSX0tFWV0gPSBwcm9wcyA9IHt9O1xuXHRcdGZvciAobGV0IGE9b3V0LmF0dHJpYnV0ZXMsIGk9YS5sZW5ndGg7IGktLTsgKSBwcm9wc1thW2ldLm5hbWVdID0gYVtpXS52YWx1ZTtcblx0fVxuXG5cdC8vIEFwcGx5IGF0dHJpYnV0ZXMvcHJvcHMgZnJvbSBWTm9kZSB0byB0aGUgRE9NIEVsZW1lbnQ6XG5cdGRpZmZBdHRyaWJ1dGVzKG91dCwgdm5vZGUuYXR0cmlidXRlcywgcHJvcHMpO1xuXG5cblx0Ly8gT3B0aW1pemF0aW9uOiBmYXN0LXBhdGggZm9yIGVsZW1lbnRzIGNvbnRhaW5pbmcgYSBzaW5nbGUgVGV4dE5vZGU6XG5cdGlmICghaHlkcmF0aW5nICYmIHZjaGlsZHJlbiAmJiB2Y2hpbGRyZW4ubGVuZ3RoPT09MSAmJiB0eXBlb2YgdmNoaWxkcmVuWzBdPT09J3N0cmluZycgJiYgZmMgJiYgZmMgaW5zdGFuY2VvZiBUZXh0ICYmICFmYy5uZXh0U2libGluZykge1xuXHRcdGlmIChmYy5ub2RlVmFsdWUhPXZjaGlsZHJlblswXSkge1xuXHRcdFx0ZmMubm9kZVZhbHVlID0gdmNoaWxkcmVuWzBdO1xuXHRcdH1cblx0fVxuXHQvLyBvdGhlcndpc2UsIGlmIHRoZXJlIGFyZSBleGlzdGluZyBvciBuZXcgY2hpbGRyZW4sIGRpZmYgdGhlbTpcblx0ZWxzZSBpZiAodmNoaWxkcmVuICYmIHZjaGlsZHJlbi5sZW5ndGggfHwgZmMpIHtcblx0XHRpbm5lckRpZmZOb2RlKG91dCwgdmNoaWxkcmVuLCBjb250ZXh0LCBtb3VudEFsbCk7XG5cdH1cblxuXG5cdC8vIGludm9rZSBvcmlnaW5hbCByZWYgKGZyb20gYmVmb3JlIHJlc29sdmluZyBQdXJlIEZ1bmN0aW9uYWwgQ29tcG9uZW50cyk6XG5cdGlmIChvcmlnaW5hbEF0dHJpYnV0ZXMgJiYgdHlwZW9mIG9yaWdpbmFsQXR0cmlidXRlcy5yZWY9PT0nZnVuY3Rpb24nKSB7XG5cdFx0KHByb3BzLnJlZiA9IG9yaWdpbmFsQXR0cmlidXRlcy5yZWYpKG91dCk7XG5cdH1cblxuXHRpc1N2Z01vZGUgPSBwcmV2U3ZnTW9kZTtcblxuXHRyZXR1cm4gb3V0O1xufVxuXG5cbi8qKiBBcHBseSBjaGlsZCBhbmQgYXR0cmlidXRlIGNoYW5nZXMgYmV0d2VlbiBhIFZOb2RlIGFuZCBhIERPTSBOb2RlIHRvIHRoZSBET00uXG4gKlx0QHBhcmFtIHtFbGVtZW50fSBkb21cdFx0RWxlbWVudCB3aG9zZSBjaGlsZHJlbiBzaG91bGQgYmUgY29tcGFyZWQgJiBtdXRhdGVkXG4gKlx0QHBhcmFtIHtBcnJheX0gdmNoaWxkcmVuXHRBcnJheSBvZiBWTm9kZXMgdG8gY29tcGFyZSB0byBgZG9tLmNoaWxkTm9kZXNgXG4gKlx0QHBhcmFtIHtPYmplY3R9IGNvbnRleHRcdFx0SW1wbGljaXRseSBkZXNjZW5kYW50IGNvbnRleHQgb2JqZWN0IChmcm9tIG1vc3QgcmVjZW50IGBnZXRDaGlsZENvbnRleHQoKWApXG4gKlx0QHBhcmFtIHtCb29sZWFufSBtb3V0QWxsXG4gKi9cbmZ1bmN0aW9uIGlubmVyRGlmZk5vZGUoZG9tLCB2Y2hpbGRyZW4sIGNvbnRleHQsIG1vdW50QWxsKSB7XG5cdGxldCBvcmlnaW5hbENoaWxkcmVuID0gZG9tLmNoaWxkTm9kZXMsXG5cdFx0Y2hpbGRyZW4gPSBbXSxcblx0XHRrZXllZCA9IHt9LFxuXHRcdGtleWVkTGVuID0gMCxcblx0XHRtaW4gPSAwLFxuXHRcdGxlbiA9IG9yaWdpbmFsQ2hpbGRyZW4ubGVuZ3RoLFxuXHRcdGNoaWxkcmVuTGVuID0gMCxcblx0XHR2bGVuID0gdmNoaWxkcmVuICYmIHZjaGlsZHJlbi5sZW5ndGgsXG5cdFx0aiwgYywgdmNoaWxkLCBjaGlsZDtcblxuXHRpZiAobGVuKSB7XG5cdFx0Zm9yIChsZXQgaT0wOyBpPGxlbjsgaSsrKSB7XG5cdFx0XHRsZXQgY2hpbGQgPSBvcmlnaW5hbENoaWxkcmVuW2ldLFxuXHRcdFx0XHRwcm9wcyA9IGNoaWxkW0FUVFJfS0VZXSxcblx0XHRcdFx0a2V5ID0gdmxlbiA/ICgoYyA9IGNoaWxkLl9jb21wb25lbnQpID8gYy5fX2tleSA6IHByb3BzID8gcHJvcHMua2V5IDogbnVsbCkgOiBudWxsO1xuXHRcdFx0aWYgKGtleSE9bnVsbCkge1xuXHRcdFx0XHRrZXllZExlbisrO1xuXHRcdFx0XHRrZXllZFtrZXldID0gY2hpbGQ7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIGlmIChoeWRyYXRpbmcgfHwgcHJvcHMpIHtcblx0XHRcdFx0Y2hpbGRyZW5bY2hpbGRyZW5MZW4rK10gPSBjaGlsZDtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRpZiAodmxlbikge1xuXHRcdGZvciAobGV0IGk9MDsgaTx2bGVuOyBpKyspIHtcblx0XHRcdHZjaGlsZCA9IHZjaGlsZHJlbltpXTtcblx0XHRcdGNoaWxkID0gbnVsbDtcblxuXHRcdFx0Ly8gaWYgKGlzRnVuY3Rpb25hbENvbXBvbmVudCh2Y2hpbGQpKSB7XG5cdFx0XHQvLyBcdHZjaGlsZCA9IGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudCh2Y2hpbGQpO1xuXHRcdFx0Ly8gfVxuXG5cdFx0XHQvLyBhdHRlbXB0IHRvIGZpbmQgYSBub2RlIGJhc2VkIG9uIGtleSBtYXRjaGluZ1xuXHRcdFx0bGV0IGtleSA9IHZjaGlsZC5rZXk7XG5cdFx0XHRpZiAoa2V5IT1udWxsKSB7XG5cdFx0XHRcdGlmIChrZXllZExlbiAmJiBrZXkgaW4ga2V5ZWQpIHtcblx0XHRcdFx0XHRjaGlsZCA9IGtleWVkW2tleV07XG5cdFx0XHRcdFx0a2V5ZWRba2V5XSA9IHVuZGVmaW5lZDtcblx0XHRcdFx0XHRrZXllZExlbi0tO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHQvLyBhdHRlbXB0IHRvIHBsdWNrIGEgbm9kZSBvZiB0aGUgc2FtZSB0eXBlIGZyb20gdGhlIGV4aXN0aW5nIGNoaWxkcmVuXG5cdFx0XHRlbHNlIGlmICghY2hpbGQgJiYgbWluPGNoaWxkcmVuTGVuKSB7XG5cdFx0XHRcdGZvciAoaj1taW47IGo8Y2hpbGRyZW5MZW47IGorKykge1xuXHRcdFx0XHRcdGMgPSBjaGlsZHJlbltqXTtcblx0XHRcdFx0XHRpZiAoYyAmJiBpc1NhbWVOb2RlVHlwZShjLCB2Y2hpbGQpKSB7XG5cdFx0XHRcdFx0XHRjaGlsZCA9IGM7XG5cdFx0XHRcdFx0XHRjaGlsZHJlbltqXSA9IHVuZGVmaW5lZDtcblx0XHRcdFx0XHRcdGlmIChqPT09Y2hpbGRyZW5MZW4tMSkgY2hpbGRyZW5MZW4tLTtcblx0XHRcdFx0XHRcdGlmIChqPT09bWluKSBtaW4rKztcblx0XHRcdFx0XHRcdGJyZWFrO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHQvLyBtb3JwaCB0aGUgbWF0Y2hlZC9mb3VuZC9jcmVhdGVkIERPTSBjaGlsZCB0byBtYXRjaCB2Y2hpbGQgKGRlZXApXG5cdFx0XHRjaGlsZCA9IGlkaWZmKGNoaWxkLCB2Y2hpbGQsIGNvbnRleHQsIG1vdW50QWxsKTtcblxuXHRcdFx0aWYgKGNoaWxkICYmIGNoaWxkIT09ZG9tKSB7XG5cdFx0XHRcdGlmIChpPj1sZW4pIHtcblx0XHRcdFx0XHRkb20uYXBwZW5kQ2hpbGQoY2hpbGQpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2UgaWYgKGNoaWxkIT09b3JpZ2luYWxDaGlsZHJlbltpXSkge1xuXHRcdFx0XHRcdGlmIChjaGlsZD09PW9yaWdpbmFsQ2hpbGRyZW5baSsxXSkge1xuXHRcdFx0XHRcdFx0cmVtb3ZlTm9kZShvcmlnaW5hbENoaWxkcmVuW2ldKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0ZG9tLmluc2VydEJlZm9yZShjaGlsZCwgb3JpZ2luYWxDaGlsZHJlbltpXSB8fCBudWxsKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cblx0aWYgKGtleWVkTGVuKSB7XG5cdFx0Zm9yIChsZXQgaSBpbiBrZXllZCkgaWYgKGtleWVkW2ldKSByZWNvbGxlY3ROb2RlVHJlZShrZXllZFtpXSk7XG5cdH1cblxuXHQvLyByZW1vdmUgb3JwaGFuZWQgY2hpbGRyZW5cblx0d2hpbGUgKG1pbjw9Y2hpbGRyZW5MZW4pIHtcblx0XHRjaGlsZCA9IGNoaWxkcmVuW2NoaWxkcmVuTGVuLS1dO1xuXHRcdGlmIChjaGlsZCkgcmVjb2xsZWN0Tm9kZVRyZWUoY2hpbGQpO1xuXHR9XG59XG5cblxuXG4vKiogUmVjdXJzaXZlbHkgcmVjeWNsZSAob3IganVzdCB1bm1vdW50KSBhIG5vZGUgYW4gaXRzIGRlc2NlbmRhbnRzLlxuICpcdEBwYXJhbSB7Tm9kZX0gbm9kZVx0XHRcdFx0XHRcdERPTSBub2RlIHRvIHN0YXJ0IHVubW91bnQvcmVtb3ZhbCBmcm9tXG4gKlx0QHBhcmFtIHtCb29sZWFufSBbdW5tb3VudE9ubHk9ZmFsc2VdXHRJZiBgdHJ1ZWAsIG9ubHkgdHJpZ2dlcnMgdW5tb3VudCBsaWZlY3ljbGUsIHNraXBzIHJlbW92YWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29sbGVjdE5vZGVUcmVlKG5vZGUsIHVubW91bnRPbmx5KSB7XG5cdGxldCBjb21wb25lbnQgPSBub2RlLl9jb21wb25lbnQ7XG5cdGlmIChjb21wb25lbnQpIHtcblx0XHQvLyBpZiBub2RlIGlzIG93bmVkIGJ5IGEgQ29tcG9uZW50LCB1bm1vdW50IHRoYXQgY29tcG9uZW50IChlbmRzIHVwIHJlY3Vyc2luZyBiYWNrIGhlcmUpXG5cdFx0dW5tb3VudENvbXBvbmVudChjb21wb25lbnQsICF1bm1vdW50T25seSk7XG5cdH1cblx0ZWxzZSB7XG5cdFx0Ly8gSWYgdGhlIG5vZGUncyBWTm9kZSBoYWQgYSByZWYgZnVuY3Rpb24sIGludm9rZSBpdCB3aXRoIG51bGwgaGVyZS5cblx0XHQvLyAodGhpcyBpcyBwYXJ0IG9mIHRoZSBSZWFjdCBzcGVjLCBhbmQgc21hcnQgZm9yIHVuc2V0dGluZyByZWZlcmVuY2VzKVxuXHRcdGlmIChub2RlW0FUVFJfS0VZXSAmJiBub2RlW0FUVFJfS0VZXS5yZWYpIG5vZGVbQVRUUl9LRVldLnJlZihudWxsKTtcblxuXHRcdGlmICghdW5tb3VudE9ubHkpIHtcblx0XHRcdGNvbGxlY3ROb2RlKG5vZGUpO1xuXHRcdH1cblxuXHRcdC8vIFJlY29sbGVjdC91bm1vdW50IGFsbCBjaGlsZHJlbi5cblx0XHQvLyAtIHdlIHVzZSAubGFzdENoaWxkIGhlcmUgYmVjYXVzZSBpdCBjYXVzZXMgbGVzcyByZWZsb3cgdGhhbiAuZmlyc3RDaGlsZFxuXHRcdC8vIC0gaXQncyBhbHNvIGNoZWFwZXIgdGhhbiBhY2Nlc3NpbmcgdGhlIC5jaGlsZE5vZGVzIExpdmUgTm9kZUxpc3Rcblx0XHRsZXQgYztcblx0XHR3aGlsZSAoKGM9bm9kZS5sYXN0Q2hpbGQpKSByZWNvbGxlY3ROb2RlVHJlZShjLCB1bm1vdW50T25seSk7XG5cdH1cbn1cblxuXG5cbi8qKiBBcHBseSBkaWZmZXJlbmNlcyBpbiBhdHRyaWJ1dGVzIGZyb20gYSBWTm9kZSB0byB0aGUgZ2l2ZW4gRE9NIEVsZW1lbnQuXG4gKlx0QHBhcmFtIHtFbGVtZW50fSBkb21cdFx0RWxlbWVudCB3aXRoIGF0dHJpYnV0ZXMgdG8gZGlmZiBgYXR0cnNgIGFnYWluc3RcbiAqXHRAcGFyYW0ge09iamVjdH0gYXR0cnNcdFx0VGhlIGRlc2lyZWQgZW5kLXN0YXRlIGtleS12YWx1ZSBhdHRyaWJ1dGUgcGFpcnNcbiAqXHRAcGFyYW0ge09iamVjdH0gb2xkXHRcdFx0Q3VycmVudC9wcmV2aW91cyBhdHRyaWJ1dGVzIChmcm9tIHByZXZpb3VzIFZOb2RlIG9yIGVsZW1lbnQncyBwcm9wIGNhY2hlKVxuICovXG5mdW5jdGlvbiBkaWZmQXR0cmlidXRlcyhkb20sIGF0dHJzLCBvbGQpIHtcblx0Ly8gcmVtb3ZlIGF0dHJpYnV0ZXMgbm8gbG9uZ2VyIHByZXNlbnQgb24gdGhlIHZub2RlIGJ5IHNldHRpbmcgdGhlbSB0byB1bmRlZmluZWRcblx0Zm9yIChsZXQgbmFtZSBpbiBvbGQpIHtcblx0XHRpZiAoIShhdHRycyAmJiBuYW1lIGluIGF0dHJzKSAmJiBvbGRbbmFtZV0hPW51bGwpIHtcblx0XHRcdHNldEFjY2Vzc29yKGRvbSwgbmFtZSwgb2xkW25hbWVdLCBvbGRbbmFtZV0gPSB1bmRlZmluZWQsIGlzU3ZnTW9kZSk7XG5cdFx0fVxuXHR9XG5cblx0Ly8gYWRkIG5ldyAmIHVwZGF0ZSBjaGFuZ2VkIGF0dHJpYnV0ZXNcblx0aWYgKGF0dHJzKSB7XG5cdFx0Zm9yIChsZXQgbmFtZSBpbiBhdHRycykge1xuXHRcdFx0aWYgKG5hbWUhPT0nY2hpbGRyZW4nICYmIG5hbWUhPT0naW5uZXJIVE1MJyAmJiAoIShuYW1lIGluIG9sZCkgfHwgYXR0cnNbbmFtZV0hPT0obmFtZT09PSd2YWx1ZScgfHwgbmFtZT09PSdjaGVja2VkJyA/IGRvbVtuYW1lXSA6IG9sZFtuYW1lXSkpKSB7XG5cdFx0XHRcdHNldEFjY2Vzc29yKGRvbSwgbmFtZSwgb2xkW25hbWVdLCBvbGRbbmFtZV0gPSBhdHRyc1tuYW1lXSwgaXNTdmdNb2RlKTtcblx0XHRcdH1cblx0XHR9XG5cdH1cbn1cbiIsImltcG9ydCB7IENvbXBvbmVudCB9IGZyb20gJy4uL2NvbXBvbmVudCc7XG5cbi8qKiBSZXRhaW5zIGEgcG9vbCBvZiBDb21wb25lbnRzIGZvciByZS11c2UsIGtleWVkIG9uIGNvbXBvbmVudCBuYW1lLlxuICpcdE5vdGU6IHNpbmNlIGNvbXBvbmVudCBuYW1lcyBhcmUgbm90IHVuaXF1ZSBvciBldmVuIG5lY2Vzc2FyaWx5IGF2YWlsYWJsZSwgdGhlc2UgYXJlIHByaW1hcmlseSBhIGZvcm0gb2Ygc2hhcmRpbmcuXG4gKlx0QHByaXZhdGVcbiAqL1xuY29uc3QgY29tcG9uZW50cyA9IHt9O1xuXG5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0Q29tcG9uZW50KGNvbXBvbmVudCkge1xuXHRsZXQgbmFtZSA9IGNvbXBvbmVudC5jb25zdHJ1Y3Rvci5uYW1lLFxuXHRcdGxpc3QgPSBjb21wb25lbnRzW25hbWVdO1xuXHRpZiAobGlzdCkgbGlzdC5wdXNoKGNvbXBvbmVudCk7XG5cdGVsc2UgY29tcG9uZW50c1tuYW1lXSA9IFtjb21wb25lbnRdO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDb21wb25lbnQoQ3RvciwgcHJvcHMsIGNvbnRleHQpIHtcblx0bGV0IGluc3QgPSBuZXcgQ3Rvcihwcm9wcywgY29udGV4dCksXG5cdFx0bGlzdCA9IGNvbXBvbmVudHNbQ3Rvci5uYW1lXTtcblx0Q29tcG9uZW50LmNhbGwoaW5zdCwgcHJvcHMsIGNvbnRleHQpO1xuXHRpZiAobGlzdCkge1xuXHRcdGZvciAobGV0IGk9bGlzdC5sZW5ndGg7IGktLTsgKSB7XG5cdFx0XHRpZiAobGlzdFtpXS5jb25zdHJ1Y3Rvcj09PUN0b3IpIHtcblx0XHRcdFx0aW5zdC5uZXh0QmFzZSA9IGxpc3RbaV0ubmV4dEJhc2U7XG5cdFx0XHRcdGxpc3Quc3BsaWNlKGksIDEpO1xuXHRcdFx0XHRicmVhaztcblx0XHRcdH1cblx0XHR9XG5cdH1cblx0cmV0dXJuIGluc3Q7XG59XG4iLCJpbXBvcnQgeyBTWU5DX1JFTkRFUiwgTk9fUkVOREVSLCBGT1JDRV9SRU5ERVIsIEFTWU5DX1JFTkRFUiwgQVRUUl9LRVkgfSBmcm9tICcuLi9jb25zdGFudHMnO1xuaW1wb3J0IG9wdGlvbnMgZnJvbSAnLi4vb3B0aW9ucyc7XG5pbXBvcnQgeyBpc0Z1bmN0aW9uLCBjbG9uZSwgZXh0ZW5kIH0gZnJvbSAnLi4vdXRpbCc7XG5pbXBvcnQgeyBlbnF1ZXVlUmVuZGVyIH0gZnJvbSAnLi4vcmVuZGVyLXF1ZXVlJztcbmltcG9ydCB7IGdldE5vZGVQcm9wcyB9IGZyb20gJy4vaW5kZXgnO1xuaW1wb3J0IHsgZGlmZiwgbW91bnRzLCBkaWZmTGV2ZWwsIGZsdXNoTW91bnRzLCByZWNvbGxlY3ROb2RlVHJlZSB9IGZyb20gJy4vZGlmZic7XG5pbXBvcnQgeyBpc0Z1bmN0aW9uYWxDb21wb25lbnQsIGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudCB9IGZyb20gJy4vZnVuY3Rpb25hbC1jb21wb25lbnQnO1xuaW1wb3J0IHsgY3JlYXRlQ29tcG9uZW50LCBjb2xsZWN0Q29tcG9uZW50IH0gZnJvbSAnLi9jb21wb25lbnQtcmVjeWNsZXInO1xuaW1wb3J0IHsgcmVtb3ZlTm9kZSB9IGZyb20gJy4uL2RvbS9pbmRleCc7XG5cblxuXG4vKiogU2V0IGEgY29tcG9uZW50J3MgYHByb3BzYCAoZ2VuZXJhbGx5IGRlcml2ZWQgZnJvbSBKU1ggYXR0cmlidXRlcykuXG4gKlx0QHBhcmFtIHtPYmplY3R9IHByb3BzXG4gKlx0QHBhcmFtIHtPYmplY3R9IFtvcHRzXVxuICpcdEBwYXJhbSB7Ym9vbGVhbn0gW29wdHMucmVuZGVyU3luYz1mYWxzZV1cdElmIGB0cnVlYCBhbmQge0BsaW5rIG9wdGlvbnMuc3luY0NvbXBvbmVudFVwZGF0ZXN9IGlzIGB0cnVlYCwgdHJpZ2dlcnMgc3luY2hyb25vdXMgcmVuZGVyaW5nLlxuICpcdEBwYXJhbSB7Ym9vbGVhbn0gW29wdHMucmVuZGVyPXRydWVdXHRcdFx0SWYgYGZhbHNlYCwgbm8gcmVuZGVyIHdpbGwgYmUgdHJpZ2dlcmVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0Q29tcG9uZW50UHJvcHMoY29tcG9uZW50LCBwcm9wcywgb3B0cywgY29udGV4dCwgbW91bnRBbGwpIHtcblx0aWYgKGNvbXBvbmVudC5fZGlzYWJsZSkgcmV0dXJuO1xuXHRjb21wb25lbnQuX2Rpc2FibGUgPSB0cnVlO1xuXG5cdGlmICgoY29tcG9uZW50Ll9fcmVmID0gcHJvcHMucmVmKSkgZGVsZXRlIHByb3BzLnJlZjtcblx0aWYgKChjb21wb25lbnQuX19rZXkgPSBwcm9wcy5rZXkpKSBkZWxldGUgcHJvcHMua2V5O1xuXG5cdGlmICghY29tcG9uZW50LmJhc2UgfHwgbW91bnRBbGwpIHtcblx0XHRpZiAoY29tcG9uZW50LmNvbXBvbmVudFdpbGxNb3VudCkgY29tcG9uZW50LmNvbXBvbmVudFdpbGxNb3VudCgpO1xuXHR9XG5cdGVsc2UgaWYgKGNvbXBvbmVudC5jb21wb25lbnRXaWxsUmVjZWl2ZVByb3BzKSB7XG5cdFx0Y29tcG9uZW50LmNvbXBvbmVudFdpbGxSZWNlaXZlUHJvcHMocHJvcHMsIGNvbnRleHQpO1xuXHR9XG5cblx0aWYgKGNvbnRleHQgJiYgY29udGV4dCE9PWNvbXBvbmVudC5jb250ZXh0KSB7XG5cdFx0aWYgKCFjb21wb25lbnQucHJldkNvbnRleHQpIGNvbXBvbmVudC5wcmV2Q29udGV4dCA9IGNvbXBvbmVudC5jb250ZXh0O1xuXHRcdGNvbXBvbmVudC5jb250ZXh0ID0gY29udGV4dDtcblx0fVxuXG5cdGlmICghY29tcG9uZW50LnByZXZQcm9wcykgY29tcG9uZW50LnByZXZQcm9wcyA9IGNvbXBvbmVudC5wcm9wcztcblx0Y29tcG9uZW50LnByb3BzID0gcHJvcHM7XG5cblx0Y29tcG9uZW50Ll9kaXNhYmxlID0gZmFsc2U7XG5cblx0aWYgKG9wdHMhPT1OT19SRU5ERVIpIHtcblx0XHRpZiAob3B0cz09PVNZTkNfUkVOREVSIHx8IG9wdGlvbnMuc3luY0NvbXBvbmVudFVwZGF0ZXMhPT1mYWxzZSB8fCAhY29tcG9uZW50LmJhc2UpIHtcblx0XHRcdHJlbmRlckNvbXBvbmVudChjb21wb25lbnQsIFNZTkNfUkVOREVSLCBtb3VudEFsbCk7XG5cdFx0fVxuXHRcdGVsc2Uge1xuXHRcdFx0ZW5xdWV1ZVJlbmRlcihjb21wb25lbnQpO1xuXHRcdH1cblx0fVxuXG5cdGlmIChjb21wb25lbnQuX19yZWYpIGNvbXBvbmVudC5fX3JlZihjb21wb25lbnQpO1xufVxuXG5cblxuLyoqIFJlbmRlciBhIENvbXBvbmVudCwgdHJpZ2dlcmluZyBuZWNlc3NhcnkgbGlmZWN5Y2xlIGV2ZW50cyBhbmQgdGFraW5nIEhpZ2gtT3JkZXIgQ29tcG9uZW50cyBpbnRvIGFjY291bnQuXG4gKlx0QHBhcmFtIHtDb21wb25lbnR9IGNvbXBvbmVudFxuICpcdEBwYXJhbSB7T2JqZWN0fSBbb3B0c11cbiAqXHRAcGFyYW0ge2Jvb2xlYW59IFtvcHRzLmJ1aWxkPWZhbHNlXVx0XHRJZiBgdHJ1ZWAsIGNvbXBvbmVudCB3aWxsIGJ1aWxkIGFuZCBzdG9yZSBhIERPTSBub2RlIGlmIG5vdCBhbHJlYWR5IGFzc29jaWF0ZWQgd2l0aCBvbmUuXG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNvbXBvbmVudChjb21wb25lbnQsIG9wdHMsIG1vdW50QWxsLCBpc0NoaWxkKSB7XG5cdGlmIChjb21wb25lbnQuX2Rpc2FibGUpIHJldHVybjtcblxuXHRsZXQgc2tpcCwgcmVuZGVyZWQsXG5cdFx0cHJvcHMgPSBjb21wb25lbnQucHJvcHMsXG5cdFx0c3RhdGUgPSBjb21wb25lbnQuc3RhdGUsXG5cdFx0Y29udGV4dCA9IGNvbXBvbmVudC5jb250ZXh0LFxuXHRcdHByZXZpb3VzUHJvcHMgPSBjb21wb25lbnQucHJldlByb3BzIHx8IHByb3BzLFxuXHRcdHByZXZpb3VzU3RhdGUgPSBjb21wb25lbnQucHJldlN0YXRlIHx8IHN0YXRlLFxuXHRcdHByZXZpb3VzQ29udGV4dCA9IGNvbXBvbmVudC5wcmV2Q29udGV4dCB8fCBjb250ZXh0LFxuXHRcdGlzVXBkYXRlID0gY29tcG9uZW50LmJhc2UsXG5cdFx0bmV4dEJhc2UgPSBjb21wb25lbnQubmV4dEJhc2UsXG5cdFx0aW5pdGlhbEJhc2UgPSBpc1VwZGF0ZSB8fCBuZXh0QmFzZSxcblx0XHRpbml0aWFsQ2hpbGRDb21wb25lbnQgPSBjb21wb25lbnQuX2NvbXBvbmVudCxcblx0XHRpbnN0LCBjYmFzZTtcblxuXHQvLyBpZiB1cGRhdGluZ1xuXHRpZiAoaXNVcGRhdGUpIHtcblx0XHRjb21wb25lbnQucHJvcHMgPSBwcmV2aW91c1Byb3BzO1xuXHRcdGNvbXBvbmVudC5zdGF0ZSA9IHByZXZpb3VzU3RhdGU7XG5cdFx0Y29tcG9uZW50LmNvbnRleHQgPSBwcmV2aW91c0NvbnRleHQ7XG5cdFx0aWYgKG9wdHMhPT1GT1JDRV9SRU5ERVJcblx0XHRcdCYmIGNvbXBvbmVudC5zaG91bGRDb21wb25lbnRVcGRhdGVcblx0XHRcdCYmIGNvbXBvbmVudC5zaG91bGRDb21wb25lbnRVcGRhdGUocHJvcHMsIHN0YXRlLCBjb250ZXh0KSA9PT0gZmFsc2UpIHtcblx0XHRcdHNraXAgPSB0cnVlO1xuXHRcdH1cblx0XHRlbHNlIGlmIChjb21wb25lbnQuY29tcG9uZW50V2lsbFVwZGF0ZSkge1xuXHRcdFx0Y29tcG9uZW50LmNvbXBvbmVudFdpbGxVcGRhdGUocHJvcHMsIHN0YXRlLCBjb250ZXh0KTtcblx0XHR9XG5cdFx0Y29tcG9uZW50LnByb3BzID0gcHJvcHM7XG5cdFx0Y29tcG9uZW50LnN0YXRlID0gc3RhdGU7XG5cdFx0Y29tcG9uZW50LmNvbnRleHQgPSBjb250ZXh0O1xuXHR9XG5cblx0Y29tcG9uZW50LnByZXZQcm9wcyA9IGNvbXBvbmVudC5wcmV2U3RhdGUgPSBjb21wb25lbnQucHJldkNvbnRleHQgPSBjb21wb25lbnQubmV4dEJhc2UgPSBudWxsO1xuXHRjb21wb25lbnQuX2RpcnR5ID0gZmFsc2U7XG5cblx0aWYgKCFza2lwKSB7XG5cdFx0aWYgKGNvbXBvbmVudC5yZW5kZXIpIHJlbmRlcmVkID0gY29tcG9uZW50LnJlbmRlcihwcm9wcywgc3RhdGUsIGNvbnRleHQpO1xuXG5cdFx0Ly8gY29udGV4dCB0byBwYXNzIHRvIHRoZSBjaGlsZCwgY2FuIGJlIHVwZGF0ZWQgdmlhIChncmFuZC0pcGFyZW50IGNvbXBvbmVudFxuXHRcdGlmIChjb21wb25lbnQuZ2V0Q2hpbGRDb250ZXh0KSB7XG5cdFx0XHRjb250ZXh0ID0gZXh0ZW5kKGNsb25lKGNvbnRleHQpLCBjb21wb25lbnQuZ2V0Q2hpbGRDb250ZXh0KCkpO1xuXHRcdH1cblxuXHRcdHdoaWxlIChpc0Z1bmN0aW9uYWxDb21wb25lbnQocmVuZGVyZWQpKSB7XG5cdFx0XHRyZW5kZXJlZCA9IGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudChyZW5kZXJlZCwgY29udGV4dCk7XG5cdFx0fVxuXG5cdFx0bGV0IGNoaWxkQ29tcG9uZW50ID0gcmVuZGVyZWQgJiYgcmVuZGVyZWQubm9kZU5hbWUsXG5cdFx0XHR0b1VubW91bnQsIGJhc2U7XG5cblx0XHRpZiAoaXNGdW5jdGlvbihjaGlsZENvbXBvbmVudCkpIHtcblx0XHRcdC8vIHNldCB1cCBoaWdoIG9yZGVyIGNvbXBvbmVudCBsaW5rXG5cblx0XHRcdGxldCBjaGlsZFByb3BzID0gZ2V0Tm9kZVByb3BzKHJlbmRlcmVkKTtcblx0XHRcdGluc3QgPSBpbml0aWFsQ2hpbGRDb21wb25lbnQ7XG5cblx0XHRcdGlmIChpbnN0ICYmIGluc3QuY29uc3RydWN0b3I9PT1jaGlsZENvbXBvbmVudCAmJiBjaGlsZFByb3BzLmtleT09aW5zdC5fX2tleSkge1xuXHRcdFx0XHRzZXRDb21wb25lbnRQcm9wcyhpbnN0LCBjaGlsZFByb3BzLCBTWU5DX1JFTkRFUiwgY29udGV4dCk7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIHtcblx0XHRcdFx0dG9Vbm1vdW50ID0gaW5zdDtcblxuXHRcdFx0XHRpbnN0ID0gY3JlYXRlQ29tcG9uZW50KGNoaWxkQ29tcG9uZW50LCBjaGlsZFByb3BzLCBjb250ZXh0KTtcblx0XHRcdFx0aW5zdC5uZXh0QmFzZSA9IGluc3QubmV4dEJhc2UgfHwgbmV4dEJhc2U7XG5cdFx0XHRcdGluc3QuX3BhcmVudENvbXBvbmVudCA9IGNvbXBvbmVudDtcblx0XHRcdFx0Y29tcG9uZW50Ll9jb21wb25lbnQgPSBpbnN0O1xuXHRcdFx0XHRzZXRDb21wb25lbnRQcm9wcyhpbnN0LCBjaGlsZFByb3BzLCBOT19SRU5ERVIsIGNvbnRleHQpO1xuXHRcdFx0XHRyZW5kZXJDb21wb25lbnQoaW5zdCwgU1lOQ19SRU5ERVIsIG1vdW50QWxsLCB0cnVlKTtcblx0XHRcdH1cblxuXHRcdFx0YmFzZSA9IGluc3QuYmFzZTtcblx0XHR9XG5cdFx0ZWxzZSB7XG5cdFx0XHRjYmFzZSA9IGluaXRpYWxCYXNlO1xuXG5cdFx0XHQvLyBkZXN0cm95IGhpZ2ggb3JkZXIgY29tcG9uZW50IGxpbmtcblx0XHRcdHRvVW5tb3VudCA9IGluaXRpYWxDaGlsZENvbXBvbmVudDtcblx0XHRcdGlmICh0b1VubW91bnQpIHtcblx0XHRcdFx0Y2Jhc2UgPSBjb21wb25lbnQuX2NvbXBvbmVudCA9IG51bGw7XG5cdFx0XHR9XG5cblx0XHRcdGlmIChpbml0aWFsQmFzZSB8fCBvcHRzPT09U1lOQ19SRU5ERVIpIHtcblx0XHRcdFx0aWYgKGNiYXNlKSBjYmFzZS5fY29tcG9uZW50ID0gbnVsbDtcblx0XHRcdFx0YmFzZSA9IGRpZmYoY2Jhc2UsIHJlbmRlcmVkLCBjb250ZXh0LCBtb3VudEFsbCB8fCAhaXNVcGRhdGUsIGluaXRpYWxCYXNlICYmIGluaXRpYWxCYXNlLnBhcmVudE5vZGUsIHRydWUpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGlmIChpbml0aWFsQmFzZSAmJiBiYXNlIT09aW5pdGlhbEJhc2UgJiYgaW5zdCE9PWluaXRpYWxDaGlsZENvbXBvbmVudCkge1xuXHRcdFx0bGV0IGJhc2VQYXJlbnQgPSBpbml0aWFsQmFzZS5wYXJlbnROb2RlO1xuXHRcdFx0aWYgKGJhc2VQYXJlbnQgJiYgYmFzZSE9PWJhc2VQYXJlbnQpIHtcblx0XHRcdFx0YmFzZVBhcmVudC5yZXBsYWNlQ2hpbGQoYmFzZSwgaW5pdGlhbEJhc2UpO1xuXG5cdFx0XHRcdGlmICghdG9Vbm1vdW50KSB7XG5cdFx0XHRcdFx0aW5pdGlhbEJhc2UuX2NvbXBvbmVudCA9IG51bGw7XG5cdFx0XHRcdFx0cmVjb2xsZWN0Tm9kZVRyZWUoaW5pdGlhbEJhc2UpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0aWYgKHRvVW5tb3VudCkge1xuXHRcdFx0dW5tb3VudENvbXBvbmVudCh0b1VubW91bnQsIGJhc2UhPT1pbml0aWFsQmFzZSk7XG5cdFx0fVxuXG5cdFx0Y29tcG9uZW50LmJhc2UgPSBiYXNlO1xuXHRcdGlmIChiYXNlICYmICFpc0NoaWxkKSB7XG5cdFx0XHRsZXQgY29tcG9uZW50UmVmID0gY29tcG9uZW50LFxuXHRcdFx0XHR0ID0gY29tcG9uZW50O1xuXHRcdFx0d2hpbGUgKCh0PXQuX3BhcmVudENvbXBvbmVudCkpIHtcblx0XHRcdFx0KGNvbXBvbmVudFJlZiA9IHQpLmJhc2UgPSBiYXNlO1xuXHRcdFx0fVxuXHRcdFx0YmFzZS5fY29tcG9uZW50ID0gY29tcG9uZW50UmVmO1xuXHRcdFx0YmFzZS5fY29tcG9uZW50Q29uc3RydWN0b3IgPSBjb21wb25lbnRSZWYuY29uc3RydWN0b3I7XG5cdFx0fVxuXHR9XG5cblx0aWYgKCFpc1VwZGF0ZSB8fCBtb3VudEFsbCkge1xuXHRcdG1vdW50cy51bnNoaWZ0KGNvbXBvbmVudCk7XG5cdH1cblx0ZWxzZSBpZiAoIXNraXApIHtcblx0XHRpZiAoY29tcG9uZW50LmNvbXBvbmVudERpZFVwZGF0ZSkge1xuXHRcdFx0Y29tcG9uZW50LmNvbXBvbmVudERpZFVwZGF0ZShwcmV2aW91c1Byb3BzLCBwcmV2aW91c1N0YXRlLCBwcmV2aW91c0NvbnRleHQpO1xuXHRcdH1cblx0XHRpZiAob3B0aW9ucy5hZnRlclVwZGF0ZSkgb3B0aW9ucy5hZnRlclVwZGF0ZShjb21wb25lbnQpO1xuXHR9XG5cblx0bGV0IGNiID0gY29tcG9uZW50Ll9yZW5kZXJDYWxsYmFja3MsIGZuO1xuXHRpZiAoY2IpIHdoaWxlICggKGZuID0gY2IucG9wKCkpICkgZm4uY2FsbChjb21wb25lbnQpO1xuXG5cdGlmICghZGlmZkxldmVsICYmICFpc0NoaWxkKSBmbHVzaE1vdW50cygpO1xufVxuXG5cblxuLyoqIEFwcGx5IHRoZSBDb21wb25lbnQgcmVmZXJlbmNlZCBieSBhIFZOb2RlIHRvIHRoZSBET00uXG4gKlx0QHBhcmFtIHtFbGVtZW50fSBkb21cdFRoZSBET00gbm9kZSB0byBtdXRhdGVcbiAqXHRAcGFyYW0ge1ZOb2RlfSB2bm9kZVx0QSBDb21wb25lbnQtcmVmZXJlbmNpbmcgVk5vZGVcbiAqXHRAcmV0dXJucyB7RWxlbWVudH0gZG9tXHRUaGUgY3JlYXRlZC9tdXRhdGVkIGVsZW1lbnRcbiAqXHRAcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDb21wb25lbnRGcm9tVk5vZGUoZG9tLCB2bm9kZSwgY29udGV4dCwgbW91bnRBbGwpIHtcblx0bGV0IGMgPSBkb20gJiYgZG9tLl9jb21wb25lbnQsXG5cdFx0b2xkRG9tID0gZG9tLFxuXHRcdGlzRGlyZWN0T3duZXIgPSBjICYmIGRvbS5fY29tcG9uZW50Q29uc3RydWN0b3I9PT12bm9kZS5ub2RlTmFtZSxcblx0XHRpc093bmVyID0gaXNEaXJlY3RPd25lcixcblx0XHRwcm9wcyA9IGdldE5vZGVQcm9wcyh2bm9kZSk7XG5cdHdoaWxlIChjICYmICFpc093bmVyICYmIChjPWMuX3BhcmVudENvbXBvbmVudCkpIHtcblx0XHRpc093bmVyID0gYy5jb25zdHJ1Y3Rvcj09PXZub2RlLm5vZGVOYW1lO1xuXHR9XG5cblx0aWYgKGMgJiYgaXNPd25lciAmJiAoIW1vdW50QWxsIHx8IGMuX2NvbXBvbmVudCkpIHtcblx0XHRzZXRDb21wb25lbnRQcm9wcyhjLCBwcm9wcywgQVNZTkNfUkVOREVSLCBjb250ZXh0LCBtb3VudEFsbCk7XG5cdFx0ZG9tID0gYy5iYXNlO1xuXHR9XG5cdGVsc2Uge1xuXHRcdGlmIChjICYmICFpc0RpcmVjdE93bmVyKSB7XG5cdFx0XHR1bm1vdW50Q29tcG9uZW50KGMsIHRydWUpO1xuXHRcdFx0ZG9tID0gb2xkRG9tID0gbnVsbDtcblx0XHR9XG5cblx0XHRjID0gY3JlYXRlQ29tcG9uZW50KHZub2RlLm5vZGVOYW1lLCBwcm9wcywgY29udGV4dCk7XG5cdFx0aWYgKGRvbSAmJiAhYy5uZXh0QmFzZSkge1xuXHRcdFx0Yy5uZXh0QmFzZSA9IGRvbTtcblx0XHRcdC8vIHBhc3NpbmcgZG9tL29sZERvbSBhcyBuZXh0QmFzZSB3aWxsIHJlY3ljbGUgaXQgaWYgdW51c2VkLCBzbyBieXBhc3MgcmVjeWNsaW5nIG9uIEwyNDE6XG5cdFx0XHRvbGREb20gPSBudWxsO1xuXHRcdH1cblx0XHRzZXRDb21wb25lbnRQcm9wcyhjLCBwcm9wcywgU1lOQ19SRU5ERVIsIGNvbnRleHQsIG1vdW50QWxsKTtcblx0XHRkb20gPSBjLmJhc2U7XG5cblx0XHRpZiAob2xkRG9tICYmIGRvbSE9PW9sZERvbSkge1xuXHRcdFx0b2xkRG9tLl9jb21wb25lbnQgPSBudWxsO1xuXHRcdFx0cmVjb2xsZWN0Tm9kZVRyZWUob2xkRG9tKTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gZG9tO1xufVxuXG5cblxuLyoqIFJlbW92ZSBhIGNvbXBvbmVudCBmcm9tIHRoZSBET00gYW5kIHJlY3ljbGUgaXQuXG4gKlx0QHBhcmFtIHtFbGVtZW50fSBkb21cdFx0XHRBIERPTSBub2RlIGZyb20gd2hpY2ggdG8gdW5tb3VudCB0aGUgZ2l2ZW4gQ29tcG9uZW50XG4gKlx0QHBhcmFtIHtDb21wb25lbnR9IGNvbXBvbmVudFx0VGhlIENvbXBvbmVudCBpbnN0YW5jZSB0byB1bm1vdW50XG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVubW91bnRDb21wb25lbnQoY29tcG9uZW50LCByZW1vdmUpIHtcblx0aWYgKG9wdGlvbnMuYmVmb3JlVW5tb3VudCkgb3B0aW9ucy5iZWZvcmVVbm1vdW50KGNvbXBvbmVudCk7XG5cblx0Ly8gY29uc29sZS5sb2coYCR7cmVtb3ZlPydSZW1vdmluZyc6J1VubW91bnRpbmcnfSBjb21wb25lbnQ6ICR7Y29tcG9uZW50LmNvbnN0cnVjdG9yLm5hbWV9YCk7XG5cdGxldCBiYXNlID0gY29tcG9uZW50LmJhc2U7XG5cblx0Y29tcG9uZW50Ll9kaXNhYmxlID0gdHJ1ZTtcblxuXHRpZiAoY29tcG9uZW50LmNvbXBvbmVudFdpbGxVbm1vdW50KSBjb21wb25lbnQuY29tcG9uZW50V2lsbFVubW91bnQoKTtcblxuXHRjb21wb25lbnQuYmFzZSA9IG51bGw7XG5cblx0Ly8gcmVjdXJzaXZlbHkgdGVhciBkb3duICYgcmVjb2xsZWN0IGhpZ2gtb3JkZXIgY29tcG9uZW50IGNoaWxkcmVuOlxuXHRsZXQgaW5uZXIgPSBjb21wb25lbnQuX2NvbXBvbmVudDtcblx0aWYgKGlubmVyKSB7XG5cdFx0dW5tb3VudENvbXBvbmVudChpbm5lciwgcmVtb3ZlKTtcblx0fVxuXHRlbHNlIGlmIChiYXNlKSB7XG5cdFx0aWYgKGJhc2VbQVRUUl9LRVldICYmIGJhc2VbQVRUUl9LRVldLnJlZikgYmFzZVtBVFRSX0tFWV0ucmVmKG51bGwpO1xuXG5cdFx0Y29tcG9uZW50Lm5leHRCYXNlID0gYmFzZTtcblxuXHRcdGlmIChyZW1vdmUpIHtcblx0XHRcdHJlbW92ZU5vZGUoYmFzZSk7XG5cdFx0XHRjb2xsZWN0Q29tcG9uZW50KGNvbXBvbmVudCk7XG5cdFx0fVxuXHRcdGxldCBjO1xuXHRcdHdoaWxlICgoYz1iYXNlLmxhc3RDaGlsZCkpIHJlY29sbGVjdE5vZGVUcmVlKGMsICFyZW1vdmUpO1xuXHRcdC8vIHJlbW92ZU9ycGhhbmVkQ2hpbGRyZW4oYmFzZS5jaGlsZE5vZGVzLCB0cnVlKTtcblx0fVxuXG5cdGlmIChjb21wb25lbnQuX19yZWYpIGNvbXBvbmVudC5fX3JlZihudWxsKTtcblx0aWYgKGNvbXBvbmVudC5jb21wb25lbnREaWRVbm1vdW50KSBjb21wb25lbnQuY29tcG9uZW50RGlkVW5tb3VudCgpO1xufVxuIiwiaW1wb3J0IHsgRk9SQ0VfUkVOREVSIH0gZnJvbSAnLi9jb25zdGFudHMnO1xuaW1wb3J0IHsgZXh0ZW5kLCBjbG9uZSwgaXNGdW5jdGlvbiB9IGZyb20gJy4vdXRpbCc7XG5pbXBvcnQgeyBjcmVhdGVMaW5rZWRTdGF0ZSB9IGZyb20gJy4vbGlua2VkLXN0YXRlJztcbmltcG9ydCB7IHJlbmRlckNvbXBvbmVudCB9IGZyb20gJy4vdmRvbS9jb21wb25lbnQnO1xuaW1wb3J0IHsgZW5xdWV1ZVJlbmRlciB9IGZyb20gJy4vcmVuZGVyLXF1ZXVlJztcblxuLyoqIEJhc2UgQ29tcG9uZW50IGNsYXNzLCBmb3IgaGUgRVM2IENsYXNzIG1ldGhvZCBvZiBjcmVhdGluZyBDb21wb25lbnRzXG4gKlx0QHB1YmxpY1xuICpcbiAqXHRAZXhhbXBsZVxuICpcdGNsYXNzIE15Rm9vIGV4dGVuZHMgQ29tcG9uZW50IHtcbiAqXHRcdHJlbmRlcihwcm9wcywgc3RhdGUpIHtcbiAqXHRcdFx0cmV0dXJuIDxkaXYgLz47XG4gKlx0XHR9XG4gKlx0fVxuICovXG5leHBvcnQgZnVuY3Rpb24gQ29tcG9uZW50KHByb3BzLCBjb250ZXh0KSB7XG5cdC8qKiBAcHJpdmF0ZSAqL1xuXHR0aGlzLl9kaXJ0eSA9IHRydWU7XG5cdC8vIC8qKiBAcHVibGljICovXG5cdC8vIHRoaXMuX2Rpc2FibGVSZW5kZXJpbmcgPSBmYWxzZTtcblx0Ly8gLyoqIEBwdWJsaWMgKi9cblx0Ly8gdGhpcy5wcmV2U3RhdGUgPSB0aGlzLnByZXZQcm9wcyA9IHRoaXMucHJldkNvbnRleHQgPSB0aGlzLmJhc2UgPSB0aGlzLm5leHRCYXNlID0gdGhpcy5fcGFyZW50Q29tcG9uZW50ID0gdGhpcy5fY29tcG9uZW50ID0gdGhpcy5fX3JlZiA9IHRoaXMuX19rZXkgPSB0aGlzLl9saW5rZWRTdGF0ZXMgPSB0aGlzLl9yZW5kZXJDYWxsYmFja3MgPSBudWxsO1xuXHQvKiogQHB1YmxpYyAqL1xuXHR0aGlzLmNvbnRleHQgPSBjb250ZXh0O1xuXHQvKiogQHR5cGUge29iamVjdH0gKi9cblx0dGhpcy5wcm9wcyA9IHByb3BzO1xuXHQvKiogQHR5cGUge29iamVjdH0gKi9cblx0aWYgKCF0aGlzLnN0YXRlKSB0aGlzLnN0YXRlID0ge307XG59XG5cblxuZXh0ZW5kKENvbXBvbmVudC5wcm90b3R5cGUsIHtcblxuXHQvKiogUmV0dXJucyBhIGBib29sZWFuYCB2YWx1ZSBpbmRpY2F0aW5nIGlmIHRoZSBjb21wb25lbnQgc2hvdWxkIHJlLXJlbmRlciB3aGVuIHJlY2VpdmluZyB0aGUgZ2l2ZW4gYHByb3BzYCBhbmQgYHN0YXRlYC5cblx0ICpcdEBwYXJhbSB7b2JqZWN0fSBuZXh0UHJvcHNcblx0ICpcdEBwYXJhbSB7b2JqZWN0fSBuZXh0U3RhdGVcblx0ICpcdEBwYXJhbSB7b2JqZWN0fSBuZXh0Q29udGV4dFxuXHQgKlx0QHJldHVybnMge0Jvb2xlYW59IHNob3VsZCB0aGUgY29tcG9uZW50IHJlLXJlbmRlclxuXHQgKlx0QG5hbWUgc2hvdWxkQ29tcG9uZW50VXBkYXRlXG5cdCAqXHRAZnVuY3Rpb25cblx0ICovXG5cdC8vIHNob3VsZENvbXBvbmVudFVwZGF0ZSgpIHtcblx0Ly8gXHRyZXR1cm4gdHJ1ZTtcblx0Ly8gfSxcblxuXG5cdC8qKiBSZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCBzZXRzIGEgc3RhdGUgcHJvcGVydHkgd2hlbiBjYWxsZWQuXG5cdCAqXHRDYWxsaW5nIGxpbmtTdGF0ZSgpIHJlcGVhdGVkbHkgd2l0aCB0aGUgc2FtZSBhcmd1bWVudHMgcmV0dXJucyBhIGNhY2hlZCBsaW5rIGZ1bmN0aW9uLlxuXHQgKlxuXHQgKlx0UHJvdmlkZXMgc29tZSBidWlsdC1pbiBzcGVjaWFsIGNhc2VzOlxuXHQgKlx0XHQtIENoZWNrYm94ZXMgYW5kIHJhZGlvIGJ1dHRvbnMgbGluayB0aGVpciBib29sZWFuIGBjaGVja2VkYCB2YWx1ZVxuXHQgKlx0XHQtIElucHV0cyBhdXRvbWF0aWNhbGx5IGxpbmsgdGhlaXIgYHZhbHVlYCBwcm9wZXJ0eVxuXHQgKlx0XHQtIEV2ZW50IHBhdGhzIGZhbGwgYmFjayB0byBhbnkgYXNzb2NpYXRlZCBDb21wb25lbnQgaWYgbm90IGZvdW5kIG9uIGFuIGVsZW1lbnRcblx0ICpcdFx0LSBJZiBsaW5rZWQgdmFsdWUgaXMgYSBmdW5jdGlvbiwgd2lsbCBpbnZva2UgaXQgYW5kIHVzZSB0aGUgcmVzdWx0XG5cdCAqXG5cdCAqXHRAcGFyYW0ge3N0cmluZ30ga2V5XHRcdFx0XHRUaGUgcGF0aCB0byBzZXQgLSBjYW4gYmUgYSBkb3Qtbm90YXRlZCBkZWVwIGtleVxuXHQgKlx0QHBhcmFtIHtzdHJpbmd9IFtldmVudFBhdGhdXHRcdElmIHNldCwgYXR0ZW1wdHMgdG8gZmluZCB0aGUgbmV3IHN0YXRlIHZhbHVlIGF0IGEgZ2l2ZW4gZG90LW5vdGF0ZWQgcGF0aCB3aXRoaW4gdGhlIG9iamVjdCBwYXNzZWQgdG8gdGhlIGxpbmtlZFN0YXRlIHNldHRlci5cblx0ICpcdEByZXR1cm5zIHtmdW5jdGlvbn0gbGlua1N0YXRlU2V0dGVyKGUpXG5cdCAqXG5cdCAqXHRAZXhhbXBsZSBVcGRhdGUgYSBcInRleHRcIiBzdGF0ZSB2YWx1ZSB3aGVuIGFuIGlucHV0IGNoYW5nZXM6XG5cdCAqXHRcdDxpbnB1dCBvbkNoYW5nZT17IHRoaXMubGlua1N0YXRlKCd0ZXh0JykgfSAvPlxuXHQgKlxuXHQgKlx0QGV4YW1wbGUgU2V0IGEgZGVlcCBzdGF0ZSB2YWx1ZSBvbiBjbGlja1xuXHQgKlx0XHQ8YnV0dG9uIG9uQ2xpY2s9eyB0aGlzLmxpbmtTdGF0ZSgndG91Y2guY29vcmRzJywgJ3RvdWNoZXMuMCcpIH0+VGFwPC9idXR0b25cblx0ICovXG5cdGxpbmtTdGF0ZShrZXksIGV2ZW50UGF0aCkge1xuXHRcdGxldCBjID0gdGhpcy5fbGlua2VkU3RhdGVzIHx8ICh0aGlzLl9saW5rZWRTdGF0ZXMgPSB7fSk7XG5cdFx0cmV0dXJuIGNba2V5K2V2ZW50UGF0aF0gfHwgKGNba2V5K2V2ZW50UGF0aF0gPSBjcmVhdGVMaW5rZWRTdGF0ZSh0aGlzLCBrZXksIGV2ZW50UGF0aCkpO1xuXHR9LFxuXG5cblx0LyoqIFVwZGF0ZSBjb21wb25lbnQgc3RhdGUgYnkgY29weWluZyBwcm9wZXJ0aWVzIGZyb20gYHN0YXRlYCB0byBgdGhpcy5zdGF0ZWAuXG5cdCAqXHRAcGFyYW0ge29iamVjdH0gc3RhdGVcdFx0QSBoYXNoIG9mIHN0YXRlIHByb3BlcnRpZXMgdG8gdXBkYXRlIHdpdGggbmV3IHZhbHVlc1xuXHQgKi9cblx0c2V0U3RhdGUoc3RhdGUsIGNhbGxiYWNrKSB7XG5cdFx0bGV0IHMgPSB0aGlzLnN0YXRlO1xuXHRcdGlmICghdGhpcy5wcmV2U3RhdGUpIHRoaXMucHJldlN0YXRlID0gY2xvbmUocyk7XG5cdFx0ZXh0ZW5kKHMsIGlzRnVuY3Rpb24oc3RhdGUpID8gc3RhdGUocywgdGhpcy5wcm9wcykgOiBzdGF0ZSk7XG5cdFx0aWYgKGNhbGxiYWNrKSAodGhpcy5fcmVuZGVyQ2FsbGJhY2tzID0gKHRoaXMuX3JlbmRlckNhbGxiYWNrcyB8fCBbXSkpLnB1c2goY2FsbGJhY2spO1xuXHRcdGVucXVldWVSZW5kZXIodGhpcyk7XG5cdH0sXG5cblxuXHQvKiogSW1tZWRpYXRlbHkgcGVyZm9ybSBhIHN5bmNocm9ub3VzIHJlLXJlbmRlciBvZiB0aGUgY29tcG9uZW50LlxuXHQgKlx0QHByaXZhdGVcblx0ICovXG5cdGZvcmNlVXBkYXRlKCkge1xuXHRcdHJlbmRlckNvbXBvbmVudCh0aGlzLCBGT1JDRV9SRU5ERVIpO1xuXHR9LFxuXG5cblx0LyoqIEFjY2VwdHMgYHByb3BzYCBhbmQgYHN0YXRlYCwgYW5kIHJldHVybnMgYSBuZXcgVmlydHVhbCBET00gdHJlZSB0byBidWlsZC5cblx0ICpcdFZpcnR1YWwgRE9NIGlzIGdlbmVyYWxseSBjb25zdHJ1Y3RlZCB2aWEgW0pTWF0oaHR0cDovL2phc29uZm9ybWF0LmNvbS93dGYtaXMtanN4KS5cblx0ICpcdEBwYXJhbSB7b2JqZWN0fSBwcm9wc1x0XHRQcm9wcyAoZWc6IEpTWCBhdHRyaWJ1dGVzKSByZWNlaXZlZCBmcm9tIHBhcmVudCBlbGVtZW50L2NvbXBvbmVudFxuXHQgKlx0QHBhcmFtIHtvYmplY3R9IHN0YXRlXHRcdFRoZSBjb21wb25lbnQncyBjdXJyZW50IHN0YXRlXG5cdCAqXHRAcGFyYW0ge29iamVjdH0gY29udGV4dFx0XHRDb250ZXh0IG9iamVjdCAoaWYgYSBwYXJlbnQgY29tcG9uZW50IGhhcyBwcm92aWRlZCBjb250ZXh0KVxuXHQgKlx0QHJldHVybnMgVk5vZGVcblx0ICovXG5cdHJlbmRlcigpIHt9XG5cbn0pO1xuIiwiaW1wb3J0IHsgZGlmZiB9IGZyb20gJy4vdmRvbS9kaWZmJztcblxuLyoqIFJlbmRlciBKU1ggaW50byBhIGBwYXJlbnRgIEVsZW1lbnQuXG4gKlx0QHBhcmFtIHtWTm9kZX0gdm5vZGVcdFx0QSAoSlNYKSBWTm9kZSB0byByZW5kZXJcbiAqXHRAcGFyYW0ge0VsZW1lbnR9IHBhcmVudFx0XHRET00gZWxlbWVudCB0byByZW5kZXIgaW50b1xuICpcdEBwYXJhbSB7RWxlbWVudH0gW21lcmdlXVx0QXR0ZW1wdCB0byByZS11c2UgYW4gZXhpc3RpbmcgRE9NIHRyZWUgcm9vdGVkIGF0IGBtZXJnZWBcbiAqXHRAcHVibGljXG4gKlxuICpcdEBleGFtcGxlXG4gKlx0Ly8gcmVuZGVyIGEgZGl2IGludG8gPGJvZHk+OlxuICpcdHJlbmRlcig8ZGl2IGlkPVwiaGVsbG9cIj5oZWxsbyE8L2Rpdj4sIGRvY3VtZW50LmJvZHkpO1xuICpcbiAqXHRAZXhhbXBsZVxuICpcdC8vIHJlbmRlciBhIFwiVGhpbmdcIiBjb21wb25lbnQgaW50byAjZm9vOlxuICpcdGNvbnN0IFRoaW5nID0gKHsgbmFtZSB9KSA9PiA8c3Bhbj57IG5hbWUgfTwvc3Bhbj47XG4gKlx0cmVuZGVyKDxUaGluZyBuYW1lPVwib25lXCIgLz4sIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyNmb28nKSk7XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXIodm5vZGUsIHBhcmVudCwgbWVyZ2UpIHtcblx0cmV0dXJuIGRpZmYobWVyZ2UsIHZub2RlLCB7fSwgZmFsc2UsIHBhcmVudCk7XG59XG4iLCJjbGFzcyBFdmVudHMge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLnRhcmdldHMgPSB7fTtcbiAgfVxuICBvbihldmVudFR5cGUsIGZuKSB7XG4gICAgdGhpcy50YXJnZXRzW2V2ZW50VHlwZV0gPSB0aGlzLnRhcmdldHNbZXZlbnRUeXBlXSB8fCBbXTtcbiAgICB0aGlzLnRhcmdldHNbZXZlbnRUeXBlXS5wdXNoKGZuKTtcbiAgfVxuICBvZmYoZXZlbnRUeXBlLCBmbikge1xuICAgIHRoaXMudGFyZ2V0c1tldmVudFR5cGVdID0gdGhpcy50YXJnZXRzW2V2ZW50VHlwZV0uZmlsdGVyKCh0KSA9PiB0ICE9PSBmbik7XG4gIH1cbiAgZmlyZShldmVudFR5cGUsIC4uLmFyZ3MpIHtcbiAgICAodGhpcy50YXJnZXRzW2V2ZW50VHlwZV0gfHwgW10pLmZvckVhY2goKGZuKSA9PiBmbiguLi5hcmdzKSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgRXZlbnRzO1xuIiwiZXhwb3J0IGNvbnN0IGhleFRvUmdiID0gKF9oZXgpID0+IHtcbiAgbGV0IGhleCA9IF9oZXg7XG4gIGlmIChoZXhbMF0gIT09ICcjJykge1xuICAgIGhleCA9IGAjJHtoZXh9YDtcbiAgfVxuICBpZiAoaGV4Lmxlbmd0aCA9PT0gNCkge1xuICAgIGNvbnN0IHIgPSBwYXJzZUludChoZXguc2xpY2UoMSwgMikgKyBoZXguc2xpY2UoMSwgMiksIDE2KSxcbiAgICAgICAgICBnID0gcGFyc2VJbnQoaGV4LnNsaWNlKDIsIDMpICsgaGV4LnNsaWNlKDIsIDMpLCAxNiksXG4gICAgICAgICAgYiA9IHBhcnNlSW50KGhleC5zbGljZSgzLCA0KSArIGhleC5zbGljZSgzLCA0KSwgMTYpO1xuICAgIHJldHVybiB7IHIsIGcsIGIgfTtcbiAgfVxuICBpZiAoaGV4Lmxlbmd0aCA9PT0gNykge1xuICAgIGNvbnN0IHIgPSBwYXJzZUludChoZXguc2xpY2UoMSwgMyksIDE2KSxcbiAgICAgICAgICBnID0gcGFyc2VJbnQoaGV4LnNsaWNlKDMsIDUpLCAxNiksXG4gICAgICAgICAgYiA9IHBhcnNlSW50KGhleC5zbGljZSg1LCA3KSwgMTYpO1xuICAgIHJldHVybiB7IHIsIGcsIGIgfTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoJ0JhZCBoZXggcHJvdmlkZWQnKTtcbn07XG5cbmV4cG9ydCBjb25zdCByZ2JhID0gKHsgciwgZywgYiB9LCBhbHBoYSA9IDEpID0+IHtcbiAgcmV0dXJuIGByZ2JhKCR7cn0sICR7Z30sICR7Yn0sICR7YWxwaGF9KWA7XG59O1xuXG5leHBvcnQgY29uc3QgaGV4VG9SZ2JhID0gKGhleCwgYWxwaGEgPSAxKSA9PiB7XG4gIHJldHVybiByZ2JhKGhleFRvUmdiKGhleCksIGFscGhhKTtcbn07XG4iLCJpbXBvcnQgeyBoIH0gZnJvbSAncHJlYWN0JztcblxuY29uc3QgU1ZHU3ltYm9scyA9ICgpID0+IChcbiAgPGRpdiBzdHlsZT1cImRpc3BsYXk6YmxvY2s7d2lkdGg6MDtoZWlnaHQ6MDtcIj5cbiAgICA8c3ZnPlxuICAgICAgPHN5bWJvbCBpZD1cImFkZC1waG90b1wiIHZpZXdCb3g9XCIwIDAgNjYgNjZcIj5cbiAgICAgICAgPGcgdHJhbnNmb3JtPVwidHJhbnNsYXRlKDEgMSlcIiBzdHJva2Utd2lkdGg9XCIyXCIgc3Ryb2tlPVwiY3VycmVudENvbG9yXCIgZmlsbD1cIm5vbmVcIiBmaWxsLXJ1bGU9XCJldmVub2RkXCI+XG4gICAgICAgICAgPHBhdGggZD1cIk00Mi4zNDMgNDEuOTU4Yy0zLjkzMi0uODI4LTguNzg2LTEuNDI1LTE0LjYxLTEuNDI1LTExLjg4MiAwLTE5LjcyNyAyLjQ4Ny0yMy45NSA0LjM2QTYuMzc2IDYuMzc2IDAgMCAwIDAgNTAuNzM4djExLjEyOWgzNC4xMzNNMTIuOCAxNC45MzNDMTIuOCA2LjY4NiAxOS40ODYgMCAyNy43MzMgMGM4LjI0OCAwIDE0LjkzNCA2LjY4NiAxNC45MzQgMTQuOTMzQzQyLjY2NyAyMy4xODEgMzUuOTggMzIgMjcuNzMzIDMyIDE5LjQ4NiAzMiAxMi44IDIzLjE4IDEyLjggMTQuOTMzek01MS4yIDQ2LjkzM3Y4LjUzNE00Ni45MzMgNTEuMmg4LjUzNFwiLz5cbiAgICAgICAgICA8Y2lyY2xlIGN4PVwiNTEuMlwiIGN5PVwiNTEuMlwiIHI9XCIxMi44XCIvPlxuICAgICAgICA8L2c+XG4gICAgICA8L3N5bWJvbD5cbiAgICAgIDxzeW1ib2wgaWQ9XCJ1cGxvYWRcIiB2aWV3Qm94PVwiMCAwIDIwIDE0XCI+XG4gICAgICAgIDxwYXRoIGQ9XCJNMTYuNzEgNS44MzlDMTYuMjU4IDIuNDg0IDEzLjQyIDAgMTAgMGE2LjczMiA2LjczMiAwIDAgMC02LjQyIDQuNjEzQzEuNDg1IDUuMDY1IDAgNi44NyAwIDkuMDMzYzAgMi4zNTQgMS44MzkgNC4zMjIgNC4xOTQgNC41MTVoMTIuMjljMS45NjgtLjE5MyAzLjUxNi0xLjg3IDMuNTE2LTMuODdhMy45MTMgMy45MTMgMCAwIDAtMy4yOS0zLjg0em0tMy4yNTggMS44MDZhLjI5My4yOTMgMCAwIDEtLjIyNi4wOTcuMjkzLjI5MyAwIDAgMS0uMjI2LS4wOTdsLTIuNjc3LTIuNjc3djYuMzIyYzAgLjE5NC0uMTMuMzIzLS4zMjMuMzIzLS4xOTQgMC0uMzIzLS4xMy0uMzIzLS4zMjNWNC45NjhMNyA3LjY0NWEuMzEyLjMxMiAwIDAgMS0uNDUyIDAgLjMxMi4zMTIgMCAwIDEgMC0uNDUxbDMuMjI2LTMuMjI2Yy4wMzItLjAzMy4wNjUtLjA2NS4wOTctLjA2NS4wNjQtLjAzMi4xNjEtLjAzMi4yNTggMCAuMDMyLjAzMi4wNjUuMDMyLjA5Ny4wNjVsMy4yMjYgMy4yMjZhLjMxMi4zMTIgMCAwIDEgMCAuNDUxelwiIHN0cm9rZT1cIm5vbmVcIiBmaWxsPVwiY3VycmVudENvbG9yXCIgZmlsbC1ydWxlPVwiZXZlbm9kZFwiLz5cbiAgICAgIDwvc3ltYm9sPlxuICAgICAgPHN5bWJvbCBpZD1cInRha2UtcGljdHVyZVwiIHZpZXdCb3g9XCIwIDAgMTggMTZcIj5cbiAgICAgICAgPHBhdGggZD1cIk02LjA5NyAxLjE2MUgyLjAzMnYtLjg3YzAtLjE2LjEzLS4yOTEuMjktLjI5MWgzLjQ4NGMuMTYgMCAuMjkuMTMuMjkuMjl2Ljg3MXpNMTcuNDIgMS43NDJILjU4YS41OC41OCAwIDAgMC0uNTguNTh2MTIuNzc1YzAgLjMyLjI2LjU4LjU4LjU4aDE2Ljg0Yy4zMiAwIC41OC0uMjYuNTgtLjU4VjIuMzIzYS41OC41OCAwIDAgMC0uNTgtLjU4MXpNNC4wNjQgNS41MTZhLjU4MS41ODEgMCAxIDEgMC0xLjE2Mi41ODEuNTgxIDAgMCAxIDAgMS4xNjJ6bTcuMjU4IDcuMjU4QTMuNzc5IDMuNzc5IDAgMCAxIDcuNTQ4IDlhMy43NzkgMy43NzkgMCAwIDEgMy43NzUtMy43NzRBMy43NzkgMy43NzkgMCAwIDEgMTUuMDk3IDlhMy43NzkgMy43NzkgMCAwIDEtMy43NzQgMy43NzR6XCIgc3Ryb2tlPVwibm9uZVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIiBmaWxsLXJ1bGU9XCJldmVub2RkXCIvPlxuICAgICAgPC9zeW1ib2w+XG4gICAgPC9zdmc+XG4gIDwvZGl2PlxuKTtcblxuZXhwb3J0IGRlZmF1bHQgU1ZHU3ltYm9scztcbiIsImltcG9ydCB7IGggfSBmcm9tICdwcmVhY3QnO1xuXG5jb25zdCBQaG90b0JveFByb2dyZXNzID0gKHsgb3B0aW9ucywgc3RlcCB9KSA9PiB7XG4gIGNvbnN0IHsgY2xhc3NOYW1lIH0gPSBvcHRpb25zO1xuICByZXR1cm4gKFxuICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tcHJvZ3Jlc3NgfT5cbiAgICAgIDx1bCBjbGFzcz17YCR7Y2xhc3NOYW1lfS1wcm9ncmVzc0xpc3RgfT5cbiAgICAgICAge1sxLCAyXS5tYXAoKGkpID0+IHtcbiAgICAgICAgICBjb25zdCBjbGFzc2VzID0gW2Ake2NsYXNzTmFtZX0tcHJvZ3Jlc3NMaXN0LWl0ZW1gXTtcbiAgICAgICAgICBpZiAoaSA9PT0gc3RlcCkge1xuICAgICAgICAgICAgY2xhc3Nlcy5wdXNoKCdpcy1zZWxlY3RlZCcpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gKDxsaSBjbGFzcz17Y2xhc3Nlcy5qb2luKCcgJyl9PjwvbGk+KTtcbiAgICAgICAgfSl9XG4gICAgICA8L3VsPlxuICAgIDwvZGl2PlxuICApO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgUGhvdG9Cb3hQcm9ncmVzcztcbiIsImltcG9ydCB7IGggfSBmcm9tICdwcmVhY3QnO1xuXG5jb25zdCBJY29uID0gKHsgbmFtZSB9KSA9PiB7XG4gIHJldHVybiAoXG4gICAgPHN2Zz5cbiAgICAgIDx1c2UgeGxpbmtIcmVmPXtgIyR7bmFtZX1gfT48L3VzZT5cbiAgICA8L3N2Zz5cbiAgKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IEljb247XG4iLCJpbXBvcnQgeyBoLCBDb21wb25lbnQgfSBmcm9tICdwcmVhY3QnO1xuaW1wb3J0IHsgaGV4VG9SZ2IsIHJnYmEsIGhleFRvUmdiYSB9IGZyb20gJy4vY29sb3InO1xuXG5jb25zdCB3aXRoQ1NTID0gKFdyYXBwZWRDb21wb25lbnQsIGNzcykgPT4ge1xuICBjbGFzcyBXaXRoQ1NTIGV4dGVuZHMgQ29tcG9uZW50IHtcbiAgICBjb21wb25lbnRXaWxsTW91bnQoKSB7XG4gICAgICBjb25zdCB7IHRoZW1lLCBjb2xvciwgY2xhc3NOYW1lLCBzaXplIH0gPSB0aGlzLnByb3BzLm9wdGlvbnM7XG4gICAgICB0aGlzLiRzdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7XG4gICAgICBkb2N1bWVudC5oZWFkLmluc2VydEJlZm9yZSh0aGlzLiRzdHlsZSwgZG9jdW1lbnQuaGVhZC5maXJzdENoaWxkKTtcblxuICAgICAgY29uc3QgcHJpbWFyeUNvbG9yID0gdGhlbWUgPT09ICdsaWdodCcgPyBoZXhUb1JnYignI2ZmZicpIDogaGV4VG9SZ2IoJyM1NTUnKTtcbiAgICAgIGNvbnN0IHNlY29uZGFyeUNvbG9yID0gaGV4VG9SZ2IoY29sb3IpO1xuICAgICAgY29uc3QgcnVsZXMgPSAoXG4gICAgICAgIGNzcyh7IGNsYXNzTmFtZSwgc2l6ZSwgcHJpbWFyeUNvbG9yLCBzZWNvbmRhcnlDb2xvciB9LCB0aGlzLnByb3BzKVxuICAgICAgICAgIC5zcGxpdCgvXFx9XFxuW1xcc10qXFwuL2cpXG4gICAgICAgICAgLmZpbHRlcigocikgPT4gISFyKVxuICAgICAgICAgIC5tYXAoKHIsIGksIGFycikgPT4ge1xuICAgICAgICAgICAgaWYgKGkgPT09IDApIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGAke3J9fWA7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGkgPT09IGFyci5sZW5ndGggLSAxKSB7XG4gICAgICAgICAgICAgIHJldHVybiBgLiR7cn1gO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGAuJHtyfX1gO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICApO1xuICAgICAgcnVsZXMuZm9yRWFjaCgocnVsZSwgaSkgPT4ge1xuICAgICAgICB0aGlzLiRzdHlsZS5zaGVldC5pbnNlcnRSdWxlKHJ1bGUsIGkpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGNvbXBvbmVudFdpbGxVbm1vdW50KCkge1xuICAgICAgdGhpcy4kc3R5bGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0aGlzLiRzdHlsZSk7XG4gICAgfVxuICAgIHJlbmRlcigpIHtcbiAgICAgIHJldHVybiA8V3JhcHBlZENvbXBvbmVudCB7Li4udGhpcy5wcm9wc30gIC8+XG4gICAgfVxuICB9XG4gIHJldHVybiBXaXRoQ1NTO1xufVxuXG5leHBvcnQgZGVmYXVsdCB3aXRoQ1NTOyIsImltcG9ydCB7IGgsIGNsb25lRWxlbWVudCB9IGZyb20gJ3ByZWFjdCc7XG5pbXBvcnQgSWNvbiBmcm9tICcuL0ljb24nO1xuaW1wb3J0IHdpdGhDU1MgZnJvbSAnLi93aXRoQ1NTJztcbmltcG9ydCB7IHJnYmEgfSBmcm9tICcuL2NvbG9yJztcblxuY29uc3QgY3NzID0gKHsgY2xhc3NOYW1lLCBzaXplLCBwcmltYXJ5Q29sb3IsIHNlY29uZGFyeUNvbG9yIH0sIHt9KSA9PiAoYFxuICAuJHtjbGFzc05hbWV9LWFjdGlvbkJhciB7XG4gICAgcGFkZGluZzogMTBweDtcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hY3Rpb25CYXItbGlzdCB7XG4gICAgbGlzdC1zdHlsZS10eXBlOiBub25lO1xuICAgIGZvbnQtc2l6ZTogMDtcbiAgICBtYXJnaW46IDA7XG4gICAgcGFkZGluZy1sZWZ0OiAwO1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tYWN0aW9uQmFyLWl0ZW0ge1xuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgfVxuICAuJHtjbGFzc05hbWV9LWFjdGlvbkJhci1pdGVtOm5vdCg6bGFzdC1jaGlsZCkge1xuICAgIG1hcmdpbi1yaWdodDogMTBweDtcbiAgfVxuICAuJHtjbGFzc05hbWV9LWFjdGlvbkJhci1idG4ge1xuICAgIHBvc2l0aW9uOiByZWxhdGl2ZTtcbiAgICB3aWR0aDogMzJweDtcbiAgICBoZWlnaHQ6IDMycHg7XG4gICAgYm9yZGVyLXJhZGl1czogM3B4O1xuICAgIGJhY2tncm91bmQtY29sb3I6ICR7cmdiYShzZWNvbmRhcnlDb2xvciwgLjUpfTtcbiAgICBjb2xvcjogJHtyZ2JhKHByaW1hcnlDb2xvcil9O1xuICAgIGN1cnNvcjogcG9pbnRlcjtcbiAgfVxuICAuJHtjbGFzc05hbWV9LWFjdGlvbkJhci1pdGVtLmlzLXNlbGVjdGVkIC4ke2NsYXNzTmFtZX0tYWN0aW9uQmFyLWJ0biB7XG4gICAgYmFja2dyb3VuZC1jb2xvcjogJHtyZ2JhKHNlY29uZGFyeUNvbG9yKX07XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hY3Rpb25CYXItYnRuIHN2ZyB7XG4gICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgIHRvcDogNTAlO1xuICAgIGxlZnQ6IDUwJTtcbiAgICB0cmFuc2Zvcm06IHRyYW5zbGF0ZSgtNTAlLCAtNTAlKTtcbiAgICBkaXNwbGF5OiBibG9jaztcbiAgICB3aWR0aDogMThweDtcbiAgICBoZWlnaHQ6IDE4cHg7XG4gIH1cbmApO1xuXG5leHBvcnQgY29uc3QgUGhvdG9Cb3hBY3Rpb25CYXJJdGVtID0gKHsgb3B0aW9ucywgaWNvbiwgaXNTZWxlY3RlZCwgb25QcmVzcyB9KSA9PiB7XG4gIGNvbnN0IHsgY2xhc3NOYW1lIH0gPSBvcHRpb25zO1xuICBjb25zdCBjbGFzc2VzID0gW2Ake2NsYXNzTmFtZX0tYWN0aW9uQmFyLWl0ZW1gXTtcbiAgaWYgKGlzU2VsZWN0ZWQpIHtcbiAgICBjbGFzc2VzLnB1c2goJ2lzLXNlbGVjdGVkJyk7XG4gIH1cbiAgcmV0dXJuIChcbiAgICA8bGkgY2xhc3M9e2NsYXNzZXMuam9pbignICcpfT5cbiAgICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tYWN0aW9uQmFyLWJ0bmB9IG9uQ2xpY2s9e29uUHJlc3N9PlxuICAgICAgICA8SWNvbiBuYW1lPXtpY29ufSAvPlxuICAgICAgPC9kaXY+XG4gICAgPC9saT5cbiAgKTtcbn07XG5cbmV4cG9ydCBjb25zdCBQaG90b0JveEFjdGlvbkJhciA9IHdpdGhDU1MoKHsgb3B0aW9ucywgY2hpbGRyZW4gfSkgPT4ge1xuICBjb25zdCB7IGNsYXNzTmFtZSB9ID0gb3B0aW9ucztcbiAgcmV0dXJuIChcbiAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LWFjdGlvbkJhcmB9PlxuICAgICAgPHVsIGNsYXNzPXtgJHtjbGFzc05hbWV9LWFjdGlvbkJhci1saXN0YH0+XG4gICAgICAgIHtjaGlsZHJlbi5tYXAoKGNoaWxkKSA9PiBjbG9uZUVsZW1lbnQoY2hpbGQsIHsgb3B0aW9ucyB9KSl9XG4gICAgICA8L3VsPlxuICAgIDwvZGl2PlxuICApO1xufSwgY3NzKTtcbiIsImltcG9ydCB7IGgsIENvbXBvbmVudCB9IGZyb20gJ3ByZWFjdCc7XG5pbXBvcnQgSWNvbiBmcm9tICcuL0ljb24nO1xuaW1wb3J0IHsgUGhvdG9Cb3hBY3Rpb25CYXIsIFBob3RvQm94QWN0aW9uQmFySXRlbSB9IGZyb20gJy4vUGhvdG9Cb3hBY3Rpb25CYXInO1xuXG5jbGFzcyBQaG90b0JveFN0ZXAxIGV4dGVuZHMgQ29tcG9uZW50IHtcbiAgY29uc3RydWN0b3IoLi4uYXJncykge1xuICAgIHN1cGVyKC4uLmFyZ3MpO1xuICAgIHRoaXMuc3RhdGUgPSB7fTtcbiAgICB0aGlzLmhhbmRsZUFjdGlvbkJveENsaWNrID0gKGUpID0+IHtcbiAgICAgIHRoaXMuJGZpbGVDaG9vc2VyLmRpc3BhdGNoRXZlbnQoXG4gICAgICAgIG5ldyBNb3VzZUV2ZW50KCdjbGljaycsIHtcbiAgICAgICAgICAndmlldyc6IHdpbmRvdyxcbiAgICAgICAgICAnYnViYmxlcyc6IGZhbHNlLFxuICAgICAgICAgICdjYW5jZWxhYmxlJzogdHJ1ZVxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9O1xuICAgIHRoaXMuX2hhbmRsZUZpbGVJbnB1dENoYW5nZSA9IChlKSA9PiB7XG4gICAgICBjb25zdCBzZWxlY3RlZEZpbGUgPSBlLnRhcmdldC5maWxlc1swXTtcbiAgICAgIHRoaXMucHJvcHMuc2VsZWN0RmlsZShzZWxlY3RlZEZpbGUpO1xuICAgIH07XG4gIH1cbiAgY29tcG9uZW50RGlkTW91bnQoKSB7XG4gICAgdGhpcy4kZmlsZUNob29zZXIuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgdGhpcy5faGFuZGxlRmlsZUlucHV0Q2hhbmdlKTtcbiAgfVxuICByZW5kZXIoKSB7XG4gICAgY29uc3QgeyBvcHRpb25zIH0gPSB0aGlzLnByb3BzO1xuICAgIGNvbnN0IHsgY2xhc3NOYW1lIH0gPSBvcHRpb25zO1xuICAgIHJldHVybiAoXG4gICAgICA8ZGl2PlxuICAgICAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LXByaW1hcnlCb3hgfT5cbiAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICBjbGFzcz17YCR7Y2xhc3NOYW1lfS1hY3Rpb25Cb3hgfVxuICAgICAgICAgICAgb25DbGljaz17dGhpcy5oYW5kbGVBY3Rpb25Cb3hDbGlja31cbiAgICAgICAgICA+XG4gICAgICAgICAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LWFjdGlvbkJveC1jb250ZW50YH0+XG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tYWN0aW9uQm94LWNvbnRlbnQtcGljV3JhcGB9PlxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tYWN0aW9uQm94LWNvbnRlbnQtcGljYH0+XG4gICAgICAgICAgICAgICAgICA8SWNvbiBuYW1lPVwiYWRkLXBob3RvXCIgLz5cbiAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tYWN0aW9uQm94LWNvbnRlbnQtY2hvb3NlYH0+XG4gICAgICAgICAgICAgICAgQ2hvb3NlIFBob3RvXG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LWFjdGlvbkJveC1jb250ZW50LWRyYWdgfT5cbiAgICAgICAgICAgICAgICBvciBkcmFnIGFuIGltYWdlIGZpbGUgaGVyZVxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPGlucHV0XG4gICAgICAgICAgICAgICAgdHlwZT1cImZpbGVcIlxuICAgICAgICAgICAgICAgIGFjY2VwdD1cImltYWdlLypcIlxuICAgICAgICAgICAgICAgIGNsYXNzPXtgJHtjbGFzc05hbWV9LWFjdGlvbkJveC1maWxlLWNob29zZXJgfVxuICAgICAgICAgICAgICAgIHJlZj17KCRlbCkgPT4gdGhpcy4kZmlsZUNob29zZXIgPSAkZWx9XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxQaG90b0JveEFjdGlvbkJhciBvcHRpb25zPXtvcHRpb25zfT5cbiAgICAgICAgICA8UGhvdG9Cb3hBY3Rpb25CYXJJdGVtIGlzU2VsZWN0ZWQ9e3RydWV9IGljb249XCJ1cGxvYWRcIiAvPlxuICAgICAgICAgIDxQaG90b0JveEFjdGlvbkJhckl0ZW0gaXNTZWxlY3RlZD17ZmFsc2V9IGljb249XCJ0YWtlLXBpY3R1cmVcIiAvPlxuICAgICAgICA8L1Bob3RvQm94QWN0aW9uQmFyPlxuICAgICAgPC9kaXY+XG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBQaG90b0JveFN0ZXAxO1xuIiwiaW1wb3J0IHsgaCwgQ29tcG9uZW50IH0gZnJvbSAncHJlYWN0JztcbmltcG9ydCBJY29uIGZyb20gJy4vSWNvbic7XG5pbXBvcnQgeyBQaG90b0JveEFjdGlvbkJhciwgUGhvdG9Cb3hBY3Rpb25CYXJJdGVtIH0gZnJvbSAnLi9QaG90b0JveEFjdGlvbkJhcic7XG5cbmNsYXNzIFBob3RvQm94U3RlcDIgZXh0ZW5kcyBDb21wb25lbnQge1xuICBjb25zdHJ1Y3RvciguLi5hcmdzKSB7XG4gICAgc3VwZXIoLi4uYXJncyk7XG4gICAgdGhpcy5zdGF0ZSA9IHt9O1xuICB9XG4gIGNvbXBvbmVudERpZE1vdW50KCkge1xuICAgIGNvbnN0IHsgc2VsZWN0ZWRGaWxlIH0gPSB0aGlzLnByb3BzO1xuICAgIGNvbnNvbGUubG9nKCdzZWxlY3RlZEZpbGUnLCBzZWxlY3RlZEZpbGUpO1xuXG4gICAgY29uc3QgaW1nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImltZ1wiKTtcbiAgICBpbWcuY2xhc3NMaXN0LmFkZChcIm9ialwiKTtcbiAgICBpbWcuZmlsZSA9IHNlbGVjdGVkRmlsZTtcbiAgICBpbWcuc3R5bGUud2lkdGggPSAnMTAwJSc7XG4gICAgaW1nLnN0eWxlLmhlaWdodCA9ICcxMDAlJztcbiAgICB0aGlzLiRwcmV2aWV3LmFwcGVuZENoaWxkKGltZyk7XG5cbiAgICBjb25zdCByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpO1xuICAgIHJlYWRlci5vbmxvYWQgPSAoKGFJbWcpID0+IChlKSA9PiB7XG4gICAgICBhSW1nLnNyYyA9IGUudGFyZ2V0LnJlc3VsdDtcbiAgICB9KShpbWcpO1xuICAgIHJlYWRlci5yZWFkQXNEYXRhVVJMKHNlbGVjdGVkRmlsZSk7XG4gIH1cbiAgcmVuZGVyKCkge1xuICAgIGNvbnN0IHsgb3B0aW9ucyB9ID0gdGhpcy5wcm9wcztcbiAgICBjb25zdCB7IGNsYXNzTmFtZSB9ID0gb3B0aW9ucztcbiAgICByZXR1cm4gKFxuICAgICAgPGRpdj5cbiAgICAgICAgPGRpdiBjbGFzcz17YCR7Y2xhc3NOYW1lfS1wcmltYXJ5Qm94YH0+XG4gICAgICAgICAgPGRpdiBjbGFzcz17YCR7Y2xhc3NOYW1lfS1hY3Rpb25Cb3hgfT5cbiAgICAgICAgICAgIDxkaXZcbiAgICAgICAgICAgICAgY2xhc3M9e2Ake2NsYXNzTmFtZX0tYWN0aW9uQm94LWNvbnRlbnRgfVxuICAgICAgICAgICAgICByZWY9eygkZWwpID0+IHRoaXMuJHByZXZpZXcgPSAkZWx9XG4gICAgICAgICAgICA+PC9kaXY+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvZGl2PlxuICAgICAgICA8UGhvdG9Cb3hBY3Rpb25CYXIgb3B0aW9ucz17b3B0aW9uc30+XG4gICAgICAgICAgPFBob3RvQm94QWN0aW9uQmFySXRlbSBpc1NlbGVjdGVkPXt0cnVlfSBpY29uPVwidXBsb2FkXCIgLz5cbiAgICAgICAgICA8UGhvdG9Cb3hBY3Rpb25CYXJJdGVtIGlzU2VsZWN0ZWQ9e2ZhbHNlfSBpY29uPVwidGFrZS1waWN0dXJlXCIgLz5cbiAgICAgICAgPC9QaG90b0JveEFjdGlvbkJhcj5cbiAgICAgIDwvZGl2PlxuICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUGhvdG9Cb3hTdGVwMjtcbiIsImltcG9ydCB7IGgsIENvbXBvbmVudCB9IGZyb20gJ3ByZWFjdCc7XG5pbXBvcnQgeyBnZXRSdWxlcyB9IGZyb20gJy4vc3R5bGUnO1xuaW1wb3J0IFNWR1N5bWJvbHMgZnJvbSAnLi9TVkdTeW1ib2xzJztcbmltcG9ydCBQaG90b0JveFByb2dyZXNzIGZyb20gJy4vUGhvdG9Cb3hQcm9ncmVzcyc7XG5pbXBvcnQgUGhvdG9Cb3hTdGVwMSBmcm9tICcuL1Bob3RvQm94U3RlcDEnO1xuaW1wb3J0IFBob3RvQm94U3RlcDIgZnJvbSAnLi9QaG90b0JveFN0ZXAyJztcbmltcG9ydCB3aXRoQ1NTIGZyb20gJy4vd2l0aENTUyc7XG5pbXBvcnQgeyByZ2JhIH0gZnJvbSAnLi9jb2xvcic7XG5cbmNvbnN0IGNzcyA9ICh7IGNsYXNzTmFtZSwgc2l6ZSwgcHJpbWFyeUNvbG9yLCBzZWNvbmRhcnlDb2xvciB9LCB7fSkgPT4gKGBcbiAgLiR7Y2xhc3NOYW1lfUNvbnRhaW5lciB7XG4gICAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICBvcGFjaXR5OiAwO1xuICAgIGZvbnQtZmFtaWx5OiBpbmhlcml0O1xuICAgIGJhY2tncm91bmQtY29sb3I6ICR7cmdiYShwcmltYXJ5Q29sb3IpfTtcbiAgICBib3JkZXI6IDFweCBzb2xpZCAke3JnYmEoc2Vjb25kYXJ5Q29sb3IsIC41KX07XG4gICAgYm9yZGVyLXJhZGl1czogM3B4O1xuICAgIGJveC1zaGFkb3c6IDAgMnB4IDIwcHggcmdiYSgwLDAsMCwgLjE1KTtcbiAgICB0cmFuc2l0aW9uOiBvcGFjaXR5IC4ycyBlYXNlLWluLW91dDtcbiAgfVxuICAuJHtjbGFzc05hbWV9IHtcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hbmNob3Ige1xuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgYm90dG9tOiAxMDAlO1xuICAgIGxlZnQ6IDUwJTtcbiAgICB0cmFuc2Zvcm06IHRyYW5zbGF0ZVgoLTUwJSk7XG4gICAgd2lkdGg6IDA7XG4gICAgaGVpZ2h0OiAwO1xuICAgIGJvcmRlci1jb2xvcjogdHJhbnNwYXJlbnQ7XG4gICAgYm9yZGVyLWJvdHRvbS1jb2xvcjogJHtyZ2JhKHNlY29uZGFyeUNvbG9yLCAuNSl9O1xuICAgIGJvcmRlci1zdHlsZTogc29saWQ7XG4gICAgYm9yZGVyLXdpZHRoOiAwIDZweCA2cHggNnB4O1xuICB9XG5cbiAgLiR7Y2xhc3NOYW1lfS1wcmltYXJ5Qm94IHtcbiAgICBwYWRkaW5nOiAxMHB4O1xuICAgIGJhY2tncm91bmQtY29sb3I6ICR7cmdiYShzZWNvbmRhcnlDb2xvciwgLjEpfTtcbiAgfVxuICAuJHtjbGFzc05hbWV9LWFjdGlvbkJveCB7XG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xuICAgIHdpZHRoOiAke3NpemV9cHg7XG4gICAgaGVpZ2h0OiAke3NpemV9cHg7XG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xuICAgIGN1cnNvcjogcG9pbnRlcjtcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiAke3JnYmEocHJpbWFyeUNvbG9yKX07XG4gICAgYm9yZGVyOiAycHggZGFzaGVkICR7cmdiYShzZWNvbmRhcnlDb2xvciwgMSl9O1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tYWN0aW9uQm94LWNvbnRlbnQge1xuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICB0b3A6IDUwJTtcbiAgICBsZWZ0OiA1MCU7XG4gICAgd2lkdGg6IDEwMCU7XG4gICAgcGFkZGluZzogMCAxMHB4O1xuICAgIHRyYW5zZm9ybTogdHJhbnNsYXRlKC01MCUsIC01MCUpO1xuICAgIGRpc3BsYXk6IGJsb2NrO1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tYWN0aW9uQm94LWNvbnRlbnQtcGljV3JhcCB7XG4gICAgZGlzcGxheTogJHtzaXplID4gMTYwID8gJ2Jsb2NrJyA6ICdub25lJ307XG4gICAgbWFyZ2luLWJvdHRvbTogJHtzaXplIC8gMTJ9cHg7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hY3Rpb25Cb3gtY29udGVudC1waWMge1xuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgICBjb2xvcjogJHtyZ2JhKHNlY29uZGFyeUNvbG9yKX07XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hY3Rpb25Cb3gtY29udGVudC1waWMgc3ZnIHtcbiAgICBkaXNwbGF5OiBibG9jaztcbiAgICB3aWR0aDogJHtzaXplIC8gMy43NX1weDtcbiAgICBoZWlnaHQ6ICR7c2l6ZSAvIDMuNzV9cHg7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hY3Rpb25Cb3gtY29udGVudC1jaG9vc2Uge1xuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgICBwYWRkaW5nLWJvdHRvbTogNHB4O1xuICAgIGJvcmRlci1ib3R0b206IDJweCBzb2xpZCAke3JnYmEoc2Vjb25kYXJ5Q29sb3IpfTtcbiAgICBmb250LXdlaWdodDogYm9sZDtcbiAgICBjb2xvcjogJHtyZ2JhKHNlY29uZGFyeUNvbG9yKX07XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hY3Rpb25Cb3gtY29udGVudC1kcmFnIHtcbiAgICBtYXJnaW4tdG9wOiAxMHB4O1xuICAgIGNvbG9yOiAke3JnYmEoc2Vjb25kYXJ5Q29sb3IsIC41KX07XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hY3Rpb25Cb3gtZmlsZS1jaG9vc2VyIHtcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgdG9wOiAwO1xuICAgIGxlZnQ6IDA7XG4gICAgZGlzcGxheTogYmxvY2s7XG4gICAgd2lkdGg6IDFweDtcbiAgICBoZWlnaHQ6IDFweDtcbiAgICBvcGFjaXR5OiAwO1xuICB9XG5cbiAgLiR7Y2xhc3NOYW1lfS1wcm9ncmVzcyB7XG4gICAgcGFkZGluZzogMTBweDtcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XG4gICAgYm9yZGVyLXRvcDogMnB4IHNvbGlkICR7cmdiYShzZWNvbmRhcnlDb2xvciwgLjEpfTtcbiAgfVxuICAuJHtjbGFzc05hbWV9LXByb2dyZXNzTGlzdCB7XG4gICAgbGlzdC1zdHlsZS10eXBlOiBub25lO1xuICAgIG1hcmdpbjogMDtcbiAgICBmb250LXNpemU6IDA7XG4gICAgcGFkZGluZy1sZWZ0OiAwO1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tcHJvZ3Jlc3NMaXN0LWl0ZW0ge1xuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgICB3aWR0aDogNnB4O1xuICAgIGhlaWdodDogNnB4O1xuICAgIGJvcmRlci1yYWRpdXM6IDEwMCU7XG4gICAgYmFja2dyb3VuZC1jb2xvcjogJHtyZ2JhKHNlY29uZGFyeUNvbG9yLCAuMjUpfTtcbiAgfVxuICAuJHtjbGFzc05hbWV9LXByb2dyZXNzTGlzdC1pdGVtOm5vdCg6bGFzdC1jaGlsZCkge1xuICAgIG1hcmdpbi1yaWdodDogNHB4O1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tcHJvZ3Jlc3NMaXN0LWl0ZW0uaXMtc2VsZWN0ZWQge1xuICAgIGJhY2tncm91bmQtY29sb3I6ICR7cmdiYShzZWNvbmRhcnlDb2xvcil9O1xuICB9XG5gKTtcblxuY2xhc3MgUGhvdG9Cb3ggZXh0ZW5kcyBDb21wb25lbnQge1xuICBjb25zdHJ1Y3RvciguLi5hcmdzKSB7XG4gICAgc3VwZXIoLi4uYXJncyk7XG4gICAgdGhpcy5zdGF0ZSA9IHtcbiAgICAgIHN0ZXA6IDEsXG4gICAgICBzZWxlY3RlZEZpbGU6IG51bGwsXG4gICAgfTtcbiAgICB0aGlzLnNlbGVjdEZpbGUgPSAoZmlsZSkgPT4ge1xuICAgICAgdGhpcy5zZXRTdGF0ZSh7XG4gICAgICAgIHNlbGVjdGVkRmlsZTogZmlsZSxcbiAgICAgICAgc3RlcDogMixcbiAgICAgIH0pO1xuICAgIH07XG4gIH1cbiAgcmVuZGVyKCkge1xuICAgIGNvbnN0IHsgb3B0aW9ucyB9ID0gdGhpcy5wcm9wcztcbiAgICBjb25zdCB7IHN0ZXAsIHNlbGVjdGVkRmlsZSB9ID0gdGhpcy5zdGF0ZTtcbiAgICBjb25zdCB7IGNsYXNzTmFtZSB9ID0gb3B0aW9ucztcbiAgICByZXR1cm4gKFxuICAgICAgPGRpdiBjbGFzc05hbWU9e2NsYXNzTmFtZX0+XG4gICAgICAgIDxTVkdTeW1ib2xzIC8+XG4gICAgICAgIDxzcGFuIGNsYXNzPXtgJHtjbGFzc05hbWV9LWFuY2hvcmB9Pjwvc3Bhbj5cbiAgICAgICAge3N0ZXAgPT09IDEgJiYgKFxuICAgICAgICAgIDxQaG90b0JveFN0ZXAxXG4gICAgICAgICAgICBzZWxlY3RGaWxlPXt0aGlzLnNlbGVjdEZpbGV9XG4gICAgICAgICAgICBvcHRpb25zPXtvcHRpb25zfVxuICAgICAgICAgIC8+XG4gICAgICAgICl9XG4gICAgICAgIHtzdGVwID09PSAyICYmIChcbiAgICAgICAgICA8UGhvdG9Cb3hTdGVwMlxuICAgICAgICAgICAgc2VsZWN0ZWRGaWxlPXtzZWxlY3RlZEZpbGV9XG4gICAgICAgICAgICBvcHRpb25zPXtvcHRpb25zfVxuICAgICAgICAgIC8+XG4gICAgICAgICl9XG4gICAgICAgIDxQaG90b0JveFByb2dyZXNzIG9wdGlvbnM9e29wdGlvbnN9IHN0ZXA9e3N0ZXB9IC8+XG4gICAgICA8L2Rpdj5cbiAgICApXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgd2l0aENTUyhQaG90b0JveCwgY3NzKTtcbiIsImV4cG9ydCBjbGFzcyBOdWxsUGhvdG9Cb3hUYXJnZXQge1xuICBpbml0KCkge1xuICAgIHJldHVybiB0aGlzO1xuICB9XG4gIGRlc3Ryb3koKSB7XG4gIH1cbiAgcG9zaXRpb24oKSB7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFBob3RvQm94VGFyZ2V0IHtcbiAgY29uc3RydWN0b3IocGhvdG9Cb3gsICR0YXJnZXQsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMucGhvdG9Cb3ggPSBwaG90b0JveDtcbiAgICB0aGlzLiR0YXJnZXQgPSAkdGFyZ2V0O1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG5cbiAgICB0aGlzLl9oYW5kbGVUYXJnZXRDbGljayA9IHRoaXMuX2hhbmRsZVRhcmdldENsaWNrLmJpbmQodGhpcyk7XG4gICAgdGhpcy5faGFuZGxlV2luZG93UmVzaXplID0gdGhpcy5faGFuZGxlV2luZG93UmVzaXplLmJpbmQodGhpcyk7XG5cbiAgICB0aGlzLiR0YXJnZXQuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCB0aGlzLl9oYW5kbGVUYXJnZXRDbGljayk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIHRoaXMuX2hhbmRsZVdpbmRvd1Jlc2l6ZSk7XG4gIH1cbiAgX2hhbmRsZVRhcmdldENsaWNrKGUpIHtcbiAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIHRoaXMucGhvdG9Cb3gudG9nZ2xlKCk7XG4gIH1cbiAgX2hhbmRsZVdpbmRvd1Jlc2l6ZShlKSB7XG4gICAgdGhpcy5wb3NpdGlvbigpO1xuICB9XG4gIGRlc3Ryb3koKSB7XG4gICAgdGhpcy4kdGFyZ2V0LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgdGhpcy5faGFuZGxlVGFyZ2V0Q2xpY2spO1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdyZXNpemUnLCB0aGlzLl9oYW5kbGVXaW5kb3dSZXNpemUpO1xuICB9XG4gIHBvc2l0aW9uKCkge1xuICAgIGNvbnN0IHJlY3QgPSB0aGlzLiR0YXJnZXQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgdGhpcy5waG90b0JveC5zZXRQb3NpdGlvbih7XG4gICAgICB0b3A6IHJlY3QudG9wICsgcmVjdC5oZWlnaHQgKyAoNiAqIDIpLFxuICAgICAgbGVmdDogcmVjdC5sZWZ0IC0gKCh0aGlzLnBob3RvQm94LiRlbC5vZmZzZXRXaWR0aCAvIDIpIC0gKHJlY3Qud2lkdGggLyAyKSksXG4gICAgfSk7XG4gIH1cbn1cbiIsImltcG9ydCB7IGgsIHJlbmRlciB9IGZyb20gJ3ByZWFjdCc7XG5pbXBvcnQgRXZlbnRzIGZyb20gJy4vRXZlbnRzJztcbmltcG9ydCBQaG90b0JveENvbXBvbmVudCBmcm9tICcuL1Bob3RvQm94JztcbmltcG9ydCB7IFBob3RvQm94VGFyZ2V0LCBOdWxsUGhvdG9Cb3hUYXJnZXQgfSBmcm9tICcuL1Bob3RvQm94VGFyZ2V0JztcblxuY2xhc3MgUGhvdG9Cb3gge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLiRjb250YWluZXIgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCdib2R5Jyk7XG4gICAgdGhpcy5ldmVudHMgPSBuZXcgRXZlbnRzKCk7XG4gICAgY29uc3QgZGVmYXVsdHMgPSB7XG4gICAgICBhdHRhY2hUb1RhcmdldDogbnVsbCxcbiAgICAgIHRoZW1lOiAnbGlnaHQnLFxuICAgICAgY29sb3I6ICcjNDU1MDU0JyxcbiAgICAgIGNsYXNzTmFtZTogJ1Bob3RvQm94JyxcbiAgICAgIHNpemU6IDI0MCxcbiAgICB9O1xuICAgIHRoaXMub3BlbmVkID0gZmFsc2U7XG4gICAgdGhpcy5vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgZGVmYXVsdHMsIG9wdGlvbnMpO1xuXG4gICAgdGhpcy50YXJnZXQgPSAoXG4gICAgICB0aGlzLm9wdGlvbnMuYXR0YWNoVG9UYXJnZXRcbiAgICAgID8gbmV3IFBob3RvQm94VGFyZ2V0KHRoaXMsIHRoaXMub3B0aW9ucy5hdHRhY2hUb1RhcmdldClcbiAgICAgIDogbmV3IE51bGxQaG90b0JveFRhcmdldCgpXG4gICAgKTtcblxuICAgIHRoaXMuX2hhbmRsZURvY3VtZW50Q2xpY2sgPSB0aGlzLl9oYW5kbGVEb2N1bWVudENsaWNrLmJpbmQodGhpcyk7XG4gICAgdGhpcy5faGFuZGxlRG9jdW1lbnRLZXl1cCA9IHRoaXMuX2hhbmRsZURvY3VtZW50S2V5dXAuYmluZCh0aGlzKTtcblxuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgdGhpcy5faGFuZGxlRG9jdW1lbnRDbGljayk7XG4gICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigna2V5dXAnLCB0aGlzLl9oYW5kbGVEb2N1bWVudEtleXVwKTtcblxuICAgIHRoaXMuJGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgdGhpcy4kZWwuY2xhc3NMaXN0LmFkZChgJHt0aGlzLm9wdGlvbnMuY2xhc3NOYW1lfUNvbnRhaW5lcmApO1xuICAgIHRoaXMuJGVsLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHsgZS5zdG9wUHJvcGFnYXRpb24oKTsgfSk7XG4gICAgdGhpcy4kZWxQcmVhY3QgPSByZW5kZXIoKFxuICAgICAgPFBob3RvQm94Q29tcG9uZW50XG4gICAgICAgIG9wdGlvbnM9e3RoaXMub3B0aW9uc31cbiAgICAgICAgZXZlbnRzPXt0aGlzLmV2ZW50c31cbiAgICAgIC8+XG4gICAgKSwgdGhpcy4kZWwpO1xuXG4gICAgdGhpcy4kY29udGFpbmVyLmFwcGVuZENoaWxkKHRoaXMuJGVsKTtcbiAgfVxuICBfaGFuZGxlRG9jdW1lbnRDbGljayhlKSB7XG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG4gIF9oYW5kbGVEb2N1bWVudEtleXVwKGUpIHtcbiAgICBpZiAoZS5rZXlDb2RlID09PSAyNykge1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH1cbiAgfVxuICBkZXN0cm95KCkge1xuICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgdGhpcy5faGFuZGxlRG9jdW1lbnRDbGljayk7XG4gICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcigna2V5dXAnLCB0aGlzLl9oYW5kbGVEb2N1bWVudEtleXVwKTtcblxuICAgIHJlbmRlcihoKCgpID0+IG51bGwpLCB0aGlzLiRlbCwgdGhpcy4kZWxQcmVhY3QpO1xuICAgIHRoaXMuJGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQodGhpcy4kZWwpO1xuXG4gICAgdGhpcy50YXJnZXQuZGVzdHJveSgpO1xuICB9XG4gIHRvZ2dsZSgpIHtcbiAgICB0aGlzLm9wZW5lZCA/IHRoaXMuY2xvc2UoKSA6IHRoaXMub3BlbigpO1xuICB9XG4gIG9wZW4oKSB7XG4gICAgdGhpcy5vcGVuZWQgPSB0cnVlO1xuICAgIHRoaXMuJGVsLnN0eWxlLm9wYWNpdHkgPSAxO1xuICAgIHRoaXMuJGVsLnN0eWxlLnBvaW50ZXJFdmVudHMgPSAnYXV0byc7XG4gICAgdGhpcy50YXJnZXQucG9zaXRpb24oKTtcbiAgfVxuICBjbG9zZSgpIHtcbiAgICB0aGlzLiRlbC5zdHlsZS5vcGFjaXR5ID0gMDtcbiAgICB0aGlzLiRlbC5zdHlsZS5wb2ludGVyRXZlbnRzID0gJ25vbmUnO1xuICAgIHRoaXMub3BlbmVkID0gZmFsc2U7XG4gIH1cbiAgc2V0UG9zaXRpb24oeyB0b3AsIGxlZnQgfSkge1xuICAgICh3aW5kb3cucmVxdWVzdElkbGVDYWxsYmFjayB8fCB3aW5kb3cuc2V0VGltZW91dCkoKCkgPT4ge1xuICAgICAgdGhpcy4kZWwuc3R5bGUudG9wID0gYCR7dG9wfXB4YDtcbiAgICAgIHRoaXMuJGVsLnN0eWxlLmxlZnQgPSBgJHtsZWZ0fXB4YDtcbiAgICAgIHRoaXMuZXZlbnRzLmZpcmUoJ3Bvc2l0aW9uJywgeyB0b3AsIGxlZnQgfSk7XG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUGhvdG9Cb3g7XG4iXSwibmFtZXMiOlsiVk5vZGUiLCJub2RlTmFtZSIsImF0dHJpYnV0ZXMiLCJjaGlsZHJlbiIsImtleSIsInN0YWNrIiwiaCIsImxhc3RTaW1wbGUiLCJjaGlsZCIsInNpbXBsZSIsImkiLCJhcmd1bWVudHMiLCJsZW5ndGgiLCJwdXNoIiwicG9wIiwiQXJyYXkiLCJTdHJpbmciLCJwIiwidW5kZWZpbmVkIiwib3B0aW9ucyIsInZub2RlIiwiZXh0ZW5kIiwib2JqIiwicHJvcHMiLCJjbG9uZSIsImRlbHZlIiwic3BsaXQiLCJpc0Z1bmN0aW9uIiwiaXNTdHJpbmciLCJoYXNoVG9DbGFzc05hbWUiLCJjIiwic3RyIiwicHJvcCIsImxjQ2FjaGUiLCJ0b0xvd2VyQ2FzZSIsInMiLCJyZXNvbHZlZCIsIlByb21pc2UiLCJyZXNvbHZlIiwiZGVmZXIiLCJ0aGVuIiwiZiIsInNldFRpbWVvdXQiLCJjbG9uZUVsZW1lbnQiLCJzbGljZSIsImNhbGwiLCJOT19SRU5ERVIiLCJTWU5DX1JFTkRFUiIsIkZPUkNFX1JFTkRFUiIsIkFTWU5DX1JFTkRFUiIsIkVNUFRZIiwiQVRUUl9LRVkiLCJTeW1ib2wiLCJmb3IiLCJOT05fRElNRU5TSU9OX1BST1BTIiwiYm94RmxleEdyb3VwIiwiY29sdW1uQ291bnQiLCJmaWxsT3BhY2l0eSIsImZsZXgiLCJmbGV4R3JvdyIsImZsZXhTaHJpbmsiLCJmbGV4TmVnYXRpdmUiLCJmb250V2VpZ2h0IiwibGluZUNsYW1wIiwibGluZUhlaWdodCIsIm9yZGVyIiwib3JwaGFucyIsInN0cm9rZU9wYWNpdHkiLCJ3aWRvd3MiLCJ6SW5kZXgiLCJ6b29tIiwiTk9OX0JVQkJMSU5HX0VWRU5UUyIsImJsdXIiLCJlcnJvciIsImZvY3VzIiwibG9hZCIsInJlc2l6ZSIsInNjcm9sbCIsImNyZWF0ZUxpbmtlZFN0YXRlIiwiY29tcG9uZW50IiwiZXZlbnRQYXRoIiwicGF0aCIsImUiLCJ0IiwidGFyZ2V0Iiwic3RhdGUiLCJ2IiwidHlwZSIsIm1hdGNoIiwiY2hlY2tlZCIsInZhbHVlIiwic2V0U3RhdGUiLCJpdGVtcyIsImVucXVldWVSZW5kZXIiLCJfZGlydHkiLCJkZWJvdW5jZVJlbmRlcmluZyIsInJlcmVuZGVyIiwibGlzdCIsInJlbmRlckNvbXBvbmVudCIsImlzRnVuY3Rpb25hbENvbXBvbmVudCIsInByb3RvdHlwZSIsInJlbmRlciIsImJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudCIsImNvbnRleHQiLCJnZXROb2RlUHJvcHMiLCJpc1NhbWVOb2RlVHlwZSIsIm5vZGUiLCJUZXh0IiwiX2NvbXBvbmVudENvbnN0cnVjdG9yIiwiaXNOYW1lZE5vZGUiLCJub3JtYWxpemVkTm9kZU5hbWUiLCJkZWZhdWx0UHJvcHMiLCJyZW1vdmVOb2RlIiwicGFyZW50Tm9kZSIsInJlbW92ZUNoaWxkIiwic2V0QWNjZXNzb3IiLCJuYW1lIiwib2xkIiwiaXNTdmciLCJjbGFzc05hbWUiLCJzdHlsZSIsImNzc1RleHQiLCJpbm5lckhUTUwiLCJfX2h0bWwiLCJsIiwiX2xpc3RlbmVycyIsInN1YnN0cmluZyIsImFkZEV2ZW50TGlzdGVuZXIiLCJldmVudFByb3h5IiwicmVtb3ZlRXZlbnRMaXN0ZW5lciIsInJlbW92ZUF0dHJpYnV0ZSIsIm5zIiwicmVtb3ZlQXR0cmlidXRlTlMiLCJzZXRBdHRyaWJ1dGVOUyIsInNldEF0dHJpYnV0ZSIsInNldFByb3BlcnR5IiwiZXZlbnQiLCJub2RlcyIsImNvbGxlY3ROb2RlIiwiRWxlbWVudCIsIl9jb21wb25lbnQiLCJjcmVhdGVOb2RlIiwiZG9jdW1lbnQiLCJjcmVhdGVFbGVtZW50TlMiLCJjcmVhdGVFbGVtZW50IiwibW91bnRzIiwiZGlmZkxldmVsIiwiaXNTdmdNb2RlIiwiaHlkcmF0aW5nIiwiZmx1c2hNb3VudHMiLCJhZnRlck1vdW50IiwiY29tcG9uZW50RGlkTW91bnQiLCJkaWZmIiwiZG9tIiwibW91bnRBbGwiLCJwYXJlbnQiLCJjb21wb25lbnRSb290IiwiU1ZHRWxlbWVudCIsInJldCIsImlkaWZmIiwiYXBwZW5kQ2hpbGQiLCJvcmlnaW5hbEF0dHJpYnV0ZXMiLCJub2RlVmFsdWUiLCJyZWNvbGxlY3ROb2RlVHJlZSIsImNyZWF0ZVRleHROb2RlIiwiYnVpbGRDb21wb25lbnRGcm9tVk5vZGUiLCJvdXQiLCJ2Y2hpbGRyZW4iLCJmaXJzdENoaWxkIiwicmVwbGFjZUNoaWxkIiwiZmMiLCJhIiwibmV4dFNpYmxpbmciLCJyZWYiLCJwcmV2U3ZnTW9kZSIsImlubmVyRGlmZk5vZGUiLCJvcmlnaW5hbENoaWxkcmVuIiwiY2hpbGROb2RlcyIsImtleWVkIiwia2V5ZWRMZW4iLCJtaW4iLCJsZW4iLCJjaGlsZHJlbkxlbiIsInZsZW4iLCJqIiwidmNoaWxkIiwiX19rZXkiLCJpbnNlcnRCZWZvcmUiLCJ1bm1vdW50T25seSIsImxhc3RDaGlsZCIsImRpZmZBdHRyaWJ1dGVzIiwiYXR0cnMiLCJjb21wb25lbnRzIiwiY29sbGVjdENvbXBvbmVudCIsImNvbnN0cnVjdG9yIiwiY3JlYXRlQ29tcG9uZW50IiwiQ3RvciIsImluc3QiLCJuZXh0QmFzZSIsInNwbGljZSIsInNldENvbXBvbmVudFByb3BzIiwib3B0cyIsIl9kaXNhYmxlIiwiX19yZWYiLCJiYXNlIiwiY29tcG9uZW50V2lsbE1vdW50IiwiY29tcG9uZW50V2lsbFJlY2VpdmVQcm9wcyIsInByZXZDb250ZXh0IiwicHJldlByb3BzIiwic3luY0NvbXBvbmVudFVwZGF0ZXMiLCJpc0NoaWxkIiwic2tpcCIsInJlbmRlcmVkIiwicHJldmlvdXNQcm9wcyIsInByZXZpb3VzU3RhdGUiLCJwcmV2U3RhdGUiLCJwcmV2aW91c0NvbnRleHQiLCJpc1VwZGF0ZSIsImluaXRpYWxCYXNlIiwiaW5pdGlhbENoaWxkQ29tcG9uZW50IiwiY2Jhc2UiLCJzaG91bGRDb21wb25lbnRVcGRhdGUiLCJjb21wb25lbnRXaWxsVXBkYXRlIiwiZ2V0Q2hpbGRDb250ZXh0IiwiY2hpbGRDb21wb25lbnQiLCJ0b1VubW91bnQiLCJjaGlsZFByb3BzIiwiX3BhcmVudENvbXBvbmVudCIsImJhc2VQYXJlbnQiLCJjb21wb25lbnRSZWYiLCJ1bnNoaWZ0IiwiY29tcG9uZW50RGlkVXBkYXRlIiwiYWZ0ZXJVcGRhdGUiLCJjYiIsIl9yZW5kZXJDYWxsYmFja3MiLCJmbiIsIm9sZERvbSIsImlzRGlyZWN0T3duZXIiLCJpc093bmVyIiwidW5tb3VudENvbXBvbmVudCIsInJlbW92ZSIsImJlZm9yZVVubW91bnQiLCJjb21wb25lbnRXaWxsVW5tb3VudCIsImlubmVyIiwiY29tcG9uZW50RGlkVW5tb3VudCIsIkNvbXBvbmVudCIsIl9saW5rZWRTdGF0ZXMiLCJjYWxsYmFjayIsIm1lcmdlIiwiRXZlbnRzIiwidGFyZ2V0cyIsImV2ZW50VHlwZSIsImZpbHRlciIsImFyZ3MiLCJmb3JFYWNoIiwiaGV4VG9SZ2IiLCJfaGV4IiwiaGV4IiwiciIsInBhcnNlSW50IiwiZyIsImIiLCJFcnJvciIsInJnYmEiLCJhbHBoYSIsIlNWR1N5bWJvbHMiLCJQaG90b0JveFByb2dyZXNzIiwic3RlcCIsIm1hcCIsImNsYXNzZXMiLCJqb2luIiwiSWNvbiIsIndpdGhDU1MiLCJXcmFwcGVkQ29tcG9uZW50IiwiY3NzIiwiV2l0aENTUyIsInRoZW1lIiwiY29sb3IiLCJzaXplIiwiJHN0eWxlIiwiaGVhZCIsInByaW1hcnlDb2xvciIsInNlY29uZGFyeUNvbG9yIiwicnVsZXMiLCJhcnIiLCJydWxlIiwic2hlZXQiLCJpbnNlcnRSdWxlIiwiUGhvdG9Cb3hBY3Rpb25CYXJJdGVtIiwiaWNvbiIsImlzU2VsZWN0ZWQiLCJvblByZXNzIiwiUGhvdG9Cb3hBY3Rpb25CYXIiLCJQaG90b0JveFN0ZXAxIiwiaGFuZGxlQWN0aW9uQm94Q2xpY2siLCIkZmlsZUNob29zZXIiLCJkaXNwYXRjaEV2ZW50IiwiTW91c2VFdmVudCIsIndpbmRvdyIsIl9oYW5kbGVGaWxlSW5wdXRDaGFuZ2UiLCJzZWxlY3RlZEZpbGUiLCJmaWxlcyIsInNlbGVjdEZpbGUiLCIkZWwiLCJQaG90b0JveFN0ZXAyIiwibG9nIiwiaW1nIiwiY2xhc3NMaXN0IiwiYWRkIiwiZmlsZSIsIndpZHRoIiwiaGVpZ2h0IiwiJHByZXZpZXciLCJyZWFkZXIiLCJGaWxlUmVhZGVyIiwib25sb2FkIiwiYUltZyIsInNyYyIsInJlc3VsdCIsInJlYWRBc0RhdGFVUkwiLCJQaG90b0JveCIsIk51bGxQaG90b0JveFRhcmdldCIsIlBob3RvQm94VGFyZ2V0IiwicGhvdG9Cb3giLCIkdGFyZ2V0IiwiX2hhbmRsZVRhcmdldENsaWNrIiwiYmluZCIsIl9oYW5kbGVXaW5kb3dSZXNpemUiLCJzdG9wUHJvcGFnYXRpb24iLCJ0b2dnbGUiLCJwb3NpdGlvbiIsInJlY3QiLCJnZXRCb3VuZGluZ0NsaWVudFJlY3QiLCJzZXRQb3NpdGlvbiIsInRvcCIsImxlZnQiLCJvZmZzZXRXaWR0aCIsIiRjb250YWluZXIiLCJxdWVyeVNlbGVjdG9yIiwiZXZlbnRzIiwiZGVmYXVsdHMiLCJvcGVuZWQiLCJPYmplY3QiLCJhc3NpZ24iLCJhdHRhY2hUb1RhcmdldCIsIl9oYW5kbGVEb2N1bWVudENsaWNrIiwiX2hhbmRsZURvY3VtZW50S2V5dXAiLCIkZWxQcmVhY3QiLCJjbG9zZSIsImtleUNvZGUiLCJkZXN0cm95Iiwib3BlbiIsIm9wYWNpdHkiLCJwb2ludGVyRXZlbnRzIiwicmVxdWVzdElkbGVDYWxsYmFjayIsImZpcmUiXSwibWFwcGluZ3MiOiI7OztBQUFBO0FBQ0EsQUFBTyxTQUFTQSxLQUFULENBQWVDLFFBQWYsRUFBeUJDLFVBQXpCLEVBQXFDQyxRQUFyQyxFQUErQzs7TUFFaERGLFFBQUwsR0FBZ0JBLFFBQWhCOzs7TUFHS0MsVUFBTCxHQUFrQkEsVUFBbEI7OztNQUdLQyxRQUFMLEdBQWdCQSxRQUFoQjs7O01BR0tDLEdBQUwsR0FBV0YsY0FBY0EsV0FBV0UsR0FBcEM7OztBQ1pEOzs7O0FBSUEsY0FBZTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztDQUFmOztBQ0FBLElBQU1DLFFBQVEsRUFBZDs7Ozs7Ozs7Ozs7QUFZQSxBQUFPLFNBQVNDLENBQVQsQ0FBV0wsUUFBWCxFQUFxQkMsVUFBckIsRUFBaUM7S0FDbkNDLFdBQVcsRUFBZjtLQUNDSSxtQkFERDtLQUNhQyxjQURiO0tBQ29CQyxlQURwQjtLQUM0QkMsVUFENUI7TUFFS0EsSUFBRUMsVUFBVUMsTUFBakIsRUFBeUJGLE1BQU0sQ0FBL0IsR0FBb0M7UUFDN0JHLElBQU4sQ0FBV0YsVUFBVUQsQ0FBVixDQUFYOztLQUVHUixjQUFjQSxXQUFXQyxRQUE3QixFQUF1QztNQUNsQyxDQUFDRSxNQUFNTyxNQUFYLEVBQW1CUCxNQUFNUSxJQUFOLENBQVdYLFdBQVdDLFFBQXRCO1NBQ1pELFdBQVdDLFFBQWxCOztRQUVNRSxNQUFNTyxNQUFiLEVBQXFCO01BQ2hCLENBQUNKLFFBQVFILE1BQU1TLEdBQU4sRUFBVCxhQUFpQ0MsS0FBckMsRUFBNEM7UUFDdENMLElBQUVGLE1BQU1JLE1BQWIsRUFBcUJGLEdBQXJCO1VBQWtDRyxJQUFOLENBQVdMLE1BQU1FLENBQU4sQ0FBWDs7R0FEN0IsTUFHSyxJQUFJRixTQUFPLElBQVAsSUFBZUEsVUFBUSxLQUEzQixFQUFrQztPQUNsQyxPQUFPQSxLQUFQLElBQWMsUUFBZCxJQUEwQkEs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
