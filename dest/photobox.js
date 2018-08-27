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

/** Create an Event handler function that sets a given state property.
 *	@param {Component} component	The component whose state should be updated
 *	@param {string} key				A dot-notated key path to update in the component's state
 *	@param {string} eventPath		A dot-notated key path to the value that should be retrieved from the Event or component
 *	@returns {function} linkedStateHandler
 *	@private
 */
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

/** Managed queue of dirty components to be re-rendered */

// items/itemsOffline swap on each rerender() call (just a simple pool technique)
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

/** Check if a VNode is a reference to a stateless functional component.
 *	A function component is represented as a VNode whose `nodeName` property is a reference to a function.
 *	If that function is not a Component (ie, has no `.render()` method on a prototype), it is considered a stateless functional component.
 *	@param {VNode} vnode	A VNode
 *	@private
 */
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

/** Check if two nodes are equivalent.
 *	@param {Element} node
 *	@param {VNode} vnode
 *	@private
 */
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





var defineProperty = function (obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
};

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

/** Removes a given DOM Node from its parent. */
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

/** DOM node pool, keyed on nodeName. */

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

/** Queue of components that have been mounted and are awaiting componentDidMount */
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

/** Retains a pool of Components for re-use, keyed on component name.
 *	Note: since component names are not unique or even necessarily available, these are primarily a form of sharding.
 *	@private
 */
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

/** Set a component's `props` (generally derived from JSX attributes).
 *	@param {Object} props
 *	@param {Object} [opts]
 *	@param {boolean} [opts.renderSync=false]	If `true` and {@link options.syncComponentUpdates} is `true`, triggers synchronous rendering.
 *	@param {boolean} [opts.render=true]			If `false`, no render will be triggered.
 */
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

/** Base Component class, for he ES6 Class method of creating Components
 *	@public
 *
 *	@example
 *	class MyFoo extends Component {
 *		render(props, state) {
 *			return <div />;
 *		}
 *	}
 */
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

/** Render JSX into a `parent` Element.
 *	@param {VNode} vnode		A (JSX) VNode to render
 *	@param {Element} parent		DOM element to render into
 *	@param {Element} [merge]	Attempt to re-use an existing DOM tree rooted at `merge`
 *	@public
 *
 *	@example
 *	// render a div into <body>:
 *	render(<div id="hello">hello!</div>, document.body);
 *
 *	@example
 *	// render a "Thing" component into #foo:
 *	const Thing = ({ name }) => <span>{ name }</span>;
 *	render(<Thing name="one" />, document.querySelector('#foo'));
 */
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
      ),
      h(
        "symbol",
        { id: "crop", viewBox: "0 0 18 18" },
        h(
          "g",
          { "stroke-width": "2", stroke: "currentColor", fill: "none", "fill-rule": "evenodd" },
          h("path", { d: "M4.09 0v4.91M13.91 16.364V18M0 4.91h13.91v8.18" }),
          h("path", { d: "M4.09 8.182v4.909H18" })
        )
      ),
      h(
        "symbol",
        { id: "filters", viewBox: "0 0 18 18" },
        h(
          "g",
          { stroke: "none", fill: "currentColor", "fill-rule": "evenodd" },
          h("circle", { cx: "9", cy: "5.25", r: "5.25" }),
          h("path", { d: "M15.131 8.075a6.748 6.748 0 0 1-3.275 3.29 6.717 6.717 0 0 1-1.664 5.968A5.25 5.25 0 0 0 18 12.75a5.246 5.246 0 0 0-2.869-4.676zM9 12c-2.713 0-5.053-1.613-6.124-3.928A5.245 5.245 0 0 0 0 12.75a5.25 5.25 0 1 0 10.5 0c0-.308-.032-.609-.083-.902C9.96 11.946 9.486 12 9 12z" })
        )
      ),
      h(
        "symbol",
        { id: "check", viewBox: "0 0 18 15" },
        h("path", { d: "M6.3 14.4L0 8.1l2.7-2.7L6.3 9l9-9L18 2.7z", stroke: "none", fill: "currentColor", "fill-rule": "evenodd" })
      )
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

        var options$$1 = this.context.options || this.props.options;
        var theme = options$$1.theme,
            colors = options$$1.colors,
            className = options$$1.className,
            size = options$$1.size;

        this.$style = document.createElement('style');
        document.head.insertBefore(this.$style, document.head.firstChild);

        var primaryColor = hexToRgb(colors.base);
        var secondaryColor = hexToRgb(colors.accent);
        var tertiaryColor = hexToRgb(colors.emphasis);
        var settings = {
          className: className, size: size, primaryColor: primaryColor, secondaryColor: secondaryColor, tertiaryColor: tertiaryColor
        };
        var rules = css(settings, this.props).split(/\}\n[\s]*\./g).filter(function (r) {
          return !!r;
        }).map(function (r) {
          return r.trim();
        }).map(function (r, i, arr) {
          var newR = r;
          if (r[0] !== '.') {
            newR = '.' + newR;
          }
          if (r[r.length - 1] !== '}') {
            newR = newR + '}';
          }
          return newR;
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

var classnames = function classnames() {
  for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }

  return args.reduce(function (acc, curr) {
    return [].concat(acc, typeof curr === 'string' ? [curr] : Object.keys(curr).filter(function (k) {
      return !!curr[k];
    }));
  }, []).join(' ');
};

var css = (function (_ref, _ref2) {
  var className = _ref.className,
      size = _ref.size,
      primaryColor = _ref.primaryColor,
      secondaryColor = _ref.secondaryColor,
      tertiaryColor = _ref.tertiaryColor;
  objectDestructuringEmpty(_ref2);
  return '\n  .' + className + '-actionBar {\n    padding: 10px;\n    font-size: 0;\n  }\n  .' + className + '-actionBar-list {\n    display: inline-block;\n    list-style-type: none;\n    margin: 0;\n    padding-left: 0;\n  }\n  .' + className + '-actionBar-item {\n    display: inline-block;\n  }\n  .' + className + '-actionBar-item:not(:last-child) {\n    margin-right: 5px;\n  }\n  .' + className + '-actionBar-btn {\n    position: relative;\n    width: 32px;\n    height: 32px;\n    border-radius: 3px;\n    background-color: ' + rgba(secondaryColor, .5) + ';\n    color: ' + rgba(primaryColor) + ';\n    cursor: pointer;\n  }\n  .' + className + '-actionBar-item.is-selected .' + className + '-actionBar-btn {\n    background-color: ' + rgba(secondaryColor) + ';\n  }\n  .' + className + '-actionBar-item.is-emphasized .' + className + '-actionBar-btn {\n    background-color: ' + rgba(tertiaryColor) + ';\n  }\n  .' + className + '-actionBar-btn svg {\n    position: absolute;\n    top: 50%;\n    left: 50%;\n    transform: translate(-50%, -50%);\n    display: block;\n    width: 18px;\n    height: 18px;\n  }\n';
});

var PhotoBoxActionBarItem = function PhotoBoxActionBarItem(_ref, _ref2) {
  var _classnames;

  var icon = _ref.icon,
      isSelected = _ref.isSelected,
      onPress = _ref.onPress,
      isEmphasized = _ref.isEmphasized;
  var options$$1 = _ref2.options;
  var className = options$$1.className;

  return h(
    'li',
    { 'class': classnames((_classnames = {}, defineProperty(_classnames, className + '-actionBar-item', true), defineProperty(_classnames, 'is-selected', isSelected), defineProperty(_classnames, 'is-emphasized', isEmphasized), _classnames)) },
    h(
      'div',
      { 'class': className + '-actionBar-btn', onClick: onPress },
      h(Icon, { name: icon })
    )
  );
};

var PhotoBoxActionBarList = function PhotoBoxActionBarList(_ref3, _ref4) {
  var children = _ref3.children;
  var options$$1 = _ref4.options;
  var className = options$$1.className;

  return h(
    'ul',
    { 'class': className + '-actionBar-list' },
    children
  );
};

var PhotoBoxActionBar = withCSS(function (_ref5, _ref6) {
  var children = _ref5.children;
  var options$$1 = _ref6.options;
  var className = options$$1.className;

  return h(
    'div',
    { 'class': className + '-actionBar' },
    children
  );
}, css);

var css$1 = (function (_ref, _ref2) {
  var className = _ref.className,
      size = _ref.size,
      primaryColor = _ref.primaryColor,
      secondaryColor = _ref.secondaryColor;
  objectDestructuringEmpty(_ref2);
  return '\n  .' + className + '-step1-actionBox {\n    position: relative;\n    width: ' + size + 'px;\n    height: ' + size + 'px;\n    text-align: center;\n    cursor: pointer;\n    background-color: ' + rgba(primaryColor) + ';\n    border: 2px dashed ' + rgba(secondaryColor, 1) + ';\n  }\n  .' + className + '-step1-actionBox-content {\n    position: absolute;\n    top: 50%;\n    left: 50%;\n    width: 100%;\n    padding: 0 10px;\n    transform: translate(-50%, -50%);\n    display: block;\n  }\n  .' + className + '-step1-actionBox-content-picWrap {\n    display: ' + (size > 160 ? 'block' : 'none') + ';\n    margin-bottom: ' + size / 12 + 'px;\n  }\n  .' + className + '-step1-actionBox-content-pic {\n    display: inline-block;\n    color: ' + rgba(secondaryColor) + ';\n  }\n  .' + className + '-step1-actionBox-content-pic svg {\n    display: block;\n    width: ' + size / 3.75 + 'px;\n    height: ' + size / 3.75 + 'px;\n  }\n  .' + className + '-step1-actionBox-content-choose {\n    display: inline-block;\n    padding-bottom: 4px;\n    border-bottom: 2px solid ' + rgba(secondaryColor) + ';\n    font-weight: bold;\n    color: ' + rgba(secondaryColor) + ';\n  }\n  .' + className + '-step1-actionBox-content-drag {\n    margin-top: 10px;\n    color: ' + rgba(secondaryColor, .5) + ';\n  }\n  .' + className + '-step1-actionBox-file-chooser {\n    position: absolute;\n    top: 0;\n    left: 0;\n    display: block;\n    width: 1px;\n    height: 1px;\n    opacity: 0;\n  }\n';
});

var dataUrlToBlob = function dataUrlToBlob(dataURL) {
  var BASE64_MARKER = ';base64,';
  if (dataURL.indexOf(BASE64_MARKER) === -1) {
    var parts = dataURL.split(',');
    var contentType = parts[0].split(':')[1];
    var raw = parts[1];

    return new Blob([raw], { type: contentType });
  }

  var parts = dataURL.split(BASE64_MARKER);
  var contentType = parts[0].split(':')[1];
  var raw = window.atob(parts[1]);
  var rawLength = raw.length;

  var uInt8Array = new Uint8Array(rawLength);

  for (var i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], { type: contentType });
};

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
      var reader = new FileReader();
      reader.onload = function (e) {
        var base64Data = e.target.result;
        _this.props.selectFile({
          name: selectedFile.name,
          size: selectedFile.size,
          type: selectedFile.type,
          base64: base64Data,
          blob: dataUrlToBlob(base64Data)
        });
      };
      reader.readAsDataURL(selectedFile);
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
    value: function render(_ref2, _ref3, _ref4) {
      var _this2 = this;

      var options$$1 = _ref4.options;
      objectDestructuringEmpty(_ref3);
      objectDestructuringEmpty(_ref2);
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
              'class': className + '-step1-actionBox',
              onClick: this.handleActionBoxClick
            },
            h(
              'div',
              { 'class': className + '-step1-actionBox-content' },
              h(
                'div',
                { 'class': className + '-step1-actionBox-content-picWrap' },
                h(
                  'div',
                  { 'class': className + '-step1-actionBox-content-pic' },
                  h(Icon, { name: 'add-photo' })
                )
              ),
              h(
                'div',
                { 'class': className + '-step1-actionBox-content-choose' },
                'Choose Photo'
              ),
              h(
                'div',
                { 'class': className + '-step1-actionBox-content-drag' },
                'or drag an image here'
              ),
              h('input', {
                type: 'file',
                accept: 'image/*',
                'class': className + '-step1-actionBox-file-chooser',
                ref: function ref($el) {
                  return _this2.$fileChooser = $el;
                }
              })
            )
          )
        ),
        h(
          PhotoBoxActionBar,
          null,
          h(
            'div',
            { style: { textAlign: 'center' } },
            h(
              PhotoBoxActionBarList,
              null,
              h(PhotoBoxActionBarItem, { isSelected: true, icon: 'upload' }),
              h(PhotoBoxActionBarItem, { isSelected: false, icon: 'take-picture' })
            )
          )
        )
      );
    }
  }]);
  return PhotoBoxStep1;
}(Component);

var PhotoBoxStep1$1 = withCSS(PhotoBoxStep1, css$1);

var MouseMover = function (_Component) {
  inherits(MouseMover, _Component);

  function MouseMover() {
    var _ref;

    classCallCheck(this, MouseMover);

    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var _this = possibleConstructorReturn(this, (_ref = MouseMover.__proto__ || Object.getPrototypeOf(MouseMover)).call.apply(_ref, [this].concat(args)));

    _this.state = { x: 0, y: 0, pressed: false };

    // Memoized values
    var _width = void 0;
    var _height = void 0;

    var setStateFromEvent = function setStateFromEvent(_ref2) {
      var e = _ref2.e,
          pressed = _ref2.pressed;

      var width = _width || e.currentTarget.offsetWidth;
      var height = _height || e.currentTarget.offsetHeight;
      var x = Math.max(0, Math.min(100, e.offsetX / width));
      var y = Math.max(0, Math.min(100, e.offsetY / height));
      _this.setState({ x: x, y: y, pressed: pressed }, function () {
        _this.props.onChange(_this.state);
      });
    };

    _this.handleChange = function (type) {
      return function (e) {
        var pressed = _this.state.pressed;

        switch (type) {
          case 'MouseDown':
            setStateFromEvent({ e: e, pressed: true });
            break;
          case 'MouseUp':
            if (pressed) {
              setStateFromEvent({ e: e, pressed: false });
            }
            break;
          case 'MouseMove':
            if (pressed) {
              setStateFromEvent({ e: e, pressed: true });
            }
            break;
          case 'MouseLeave':
            if (pressed) {
              setStateFromEvent({ e: e, pressed: false });
            }
            break;
          default:
            throw new Error('Invalid event type');
        }
      };
    };
    return _this;
  }

  createClass(MouseMover, [{
    key: 'render',
    value: function render(_ref3, _ref4) {
      var children = _ref3.children;
      var x = _ref4.x,
          y = _ref4.y,
          pressed = _ref4.pressed;

      var child = children[0];
      var el = typeof child === 'function' ? child({ x: x, y: y, pressed: pressed }) : child;
      return cloneElement(el, {
        onMouseDown: this.handleChange('MouseDown'),
        onMouseUp: this.handleChange('MouseUp'),
        onMouseLeave: this.handleChange('MouseLeave'),
        onMouseMove: this.handleChange('MouseMove')
      });
    }
  }]);
  return MouseMover;
}(Component);

var css$2 = (function (_ref, _ref2) {
  var className = _ref.className,
      size = _ref.size,
      primaryColor = _ref.primaryColor,
      secondaryColor = _ref.secondaryColor;
  objectDestructuringEmpty(_ref2);
  return '\n  .' + className + '-slider {\n    position: relative;\n    width: 100%;\n    height: 20px;\n    cursor: default;\n  }\n  .' + className + '-slider-wrap {\n    position: relative;\n    margin: 0 auto;\n    width: calc(100% - 20px);\n    height: 20px;\n    pointer-events: none;\n  }\n  .' + className + '-slider-handle {\n    position: absolute;\n    top: 0;\n    left: 0;\n    width: 20px;\n    height: 20px;\n    pointer-events: none;\n    cursor: move;\n    background-color: ' + rgba(primaryColor) + ';\n    border-radius: 100%;\n    box-shadow: 0 1px 3px ' + rgba(secondaryColor, .5) + ';\n  }\n  .' + className + '-slider-bar {\n    position: absolute;\n    top: 50%;\n    margin-top: -2px;\n    width: 100%;\n    height: 4px;\n    border-radius: 2px;\n    background-color: ' + rgba(primaryColor, .5) + ';\n    box-shadow: 0 1px 4px ' + rgba(secondaryColor, .2) + ';\n  }\n';
});

var Slider = function Slider(_ref, _ref2) {
  var _onChange = _ref.onChange;
  var options$$1 = _ref2.options;
  var className = options$$1.className;

  return h(
    MouseMover,
    { onChange: function onChange(_ref3) {
        var x = _ref3.x;
        return _onChange(x);
      } },
    function (_ref4) {
      var x = _ref4.x;
      return h(
        'div',
        { 'class': className + '-slider' },
        h(
          'div',
          { 'class': className + '-slider-wrap' },
          h('div', { 'class': className + '-slider-bar' }),
          h('div', {
            'class': className + '-slider-handle',
            style: { left: 'calc(' + (x * 100).toFixed(2) + '% - 10px)' }
          })
        )
      );
    }
  );
};

var Slider$1 = withCSS(Slider, css$2);

var MouseDragger = function (_Component) {
  inherits(MouseDragger, _Component);

  function MouseDragger() {
    var _ref;

    classCallCheck(this, MouseDragger);

    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var _this = possibleConstructorReturn(this, (_ref = MouseDragger.__proto__ || Object.getPrototypeOf(MouseDragger)).call.apply(_ref, [this].concat(args)));

    _this.state = {
      x: 0, y: 0,
      deltaX: 0, deltaY: 0,
      pressed: false
    };

    var prevX = void 0;
    var prevY = void 0;

    var setStateFromEvent = function setStateFromEvent(_ref2) {
      var e = _ref2.e,
          pressed = _ref2.pressed;

      var x = e.offsetX;
      var y = e.offsetY;
      var deltaX = x - (prevX || x);
      var deltaY = y - (prevY || y);

      prevX = pressed ? x : null;
      prevY = pressed ? y : null;

      _this.setState({ x: x, y: y, deltaX: deltaX, deltaY: deltaY, pressed: pressed }, function () {
        _this.props.onChange(_this.state);
      });
    };

    _this.handleChange = function (type) {
      return function (e) {
        var pressed = _this.state.pressed;

        switch (type) {
          case 'MouseDown':
            setStateFromEvent({ e: e, pressed: true });
            break;
          case 'MouseUp':
            if (pressed) {
              setStateFromEvent({ e: e, pressed: false });
            }
            break;
          case 'MouseMove':
            if (pressed) {
              setStateFromEvent({ e: e, pressed: true });
            }
            break;
          case 'MouseLeave':
            if (pressed) {
              setStateFromEvent({ e: e, pressed: false });
            }
            break;
          default:
            throw new Error('Invalid event type');
        }
      };
    };
    return _this;
  }

  createClass(MouseDragger, [{
    key: 'render',
    value: function render(_ref3, _ref4) {
      var children = _ref3.children;
      var x = _ref4.x,
          y = _ref4.y,
          deltaX = _ref4.deltaX,
          deltaY = _ref4.deltaY;

      var child = children[0];
      var el = typeof child === 'function' ? child({ x: x, y: y, deltaX: deltaX, deltaY: deltaY }) : child;
      return cloneElement(el, {
        onMouseDown: this.handleChange('MouseDown'),
        onMouseUp: this.handleChange('MouseUp'),
        onMouseLeave: this.handleChange('MouseLeave'),
        onMouseMove: this.handleChange('MouseMove')
      });
    }
  }]);
  return MouseDragger;
}(Component);

var css$3 = (function (_ref, _ref2) {
  var className = _ref.className,
      size = _ref.size,
      primaryColor = _ref.primaryColor,
      secondaryColor = _ref.secondaryColor;
  objectDestructuringEmpty(_ref2);
  return '\n  .' + className + '-step2-actionBox {\n    position: relative;\n    width: ' + size + 'px;\n    height: ' + size + 'px;\n    text-align: center;\n    cursor: move;\n    border: 2px solid ' + rgba(primaryColor) + ';\n  }\n  .' + className + '-step2-canvas {\n    position: absolute;\n    top: 0;\n    left: 0;\n    width: 100%;\n    height: 100%;\n  }\n  .' + className + '-step2-frame {\n    position: absolute;\n    top: 0;\n    left: 0;\n    width: 100%;\n    height: 100%;\n    border: 10px solid ' + rgba(secondaryColor, .5) + ';\n  }\n  .' + className + '-step2-slider {\n    position: absolute;\n    bottom: 22px;\n    left: 22px;\n    right: 22px;\n    opacity: 0;\n    transition: opacity .2s ease-in-out;\n  }\n  .' + className + ':hover .' + className + '-primaryBox:not(.is-dragging) .' + className + '-step2-slider {\n    opacity: 1;\n  }\n';
});

var PhotoBoxStep2 = function (_Component) {
  inherits(PhotoBoxStep2, _Component);

  function PhotoBoxStep2() {
    var _ref;

    classCallCheck(this, PhotoBoxStep2);

    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var _this = possibleConstructorReturn(this, (_ref = PhotoBoxStep2.__proto__ || Object.getPrototypeOf(PhotoBoxStep2)).call.apply(_ref, [this].concat(args)));

    var frameSize = _this.context.options.size;
    _this.state = {
      imageSize: frameSize,
      imageX: 10,
      imageY: 10,
      dragging: false
    };

    _this.handleSaveClick = function () {
      var _this$props = _this.props,
          selectedFile = _this$props.selectedFile,
          processFile = _this$props.processFile;


      var newCanvas = document.createElement('canvas');
      var newContext = newCanvas.getContext('2d');

      newCanvas.width = frameSize;
      newCanvas.height = frameSize;

      newContext.drawImage(_this.canvas, -10, -10);

      var base64Data = newCanvas.toDataURL("image/jpeg");
      var blob = dataUrlToBlob(base64Data);

      processFile({
        name: selectedFile.name,
        size: blob.size,
        type: blob.type,
        base64: base64Data,
        blob: blob
      });
    };

    _this.onSliderChange = function (percent) {
      var changes = {};
      var newImageSize = frameSize * (1.0 + percent);

      var _this$state = _this.state,
          imageX = _this$state.imageX,
          imageY = _this$state.imageY;

      if (imageX + newImageSize < frameSize + 10) {
        changes.imageX = frameSize + 10 - newImageSize;
      }
      if (imageY + newImageSize < frameSize + 10) {
        changes.imageY = frameSize + 10 - newImageSize;
      }

      changes.imageSize = newImageSize;
      _this.setState(changes);
    };

    _this.handleMouseDraggerChange = function (_ref2) {
      var deltaX = _ref2.deltaX,
          deltaY = _ref2.deltaY,
          pressed = _ref2.pressed;
      var _this$state2 = _this.state,
          imageX = _this$state2.imageX,
          imageY = _this$state2.imageY,
          imageSize = _this$state2.imageSize;


      var newImageX = Math.min(10, imageX + deltaX);
      var newImageY = Math.min(10, imageY + deltaY);

      if (newImageX + imageSize < frameSize + 10) {
        newImageX = frameSize + 10 - imageSize;
      }
      if (newImageY + imageSize < frameSize + 10) {
        newImageY = frameSize + 10 - imageSize;
      }

      _this.setState({
        imageX: newImageX,
        imageY: newImageY,
        dragging: pressed
      });
    };

    _this._drawImage = function (imgDataAsBase64) {
      var size = _this.context.options.size;
      var _this$state3 = _this.state,
          imageSize = _this$state3.imageSize,
          imageX = _this$state3.imageX,
          imageY = _this$state3.imageY;
      // const offset = (imageSize - (size + (10 * 2))) / -2;

      var img = new Image();
      img.onload = function () {
        var context = _this.canvas.getContext('2d');
        context.clearRect(0, 0, _this.canvas.width, _this.canvas.height);
        context.drawImage(img, imageX, imageY, imageSize, imageSize);
      };
      img.src = imgDataAsBase64;
    };
    return _this;
  }

  createClass(PhotoBoxStep2, [{
    key: 'componentDidMount',
    value: function componentDidMount() {
      var _this2 = this;

      var selectedFile = this.props.selectedFile;
      var imageSize = this.state.imageSize;
      var options$$1 = this.context.options;

      // TODO: Magic number (padding)

      var canvasSize = imageSize + 10 * 2;
      var canvas = document.createElement('canvas');
      this.canvas = canvas;
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      this.$preview.appendChild(canvas);

      this.drawImage = function () {
        return _this2._drawImage(selectedFile.base64);
      };
      this.drawImage();
    }
  }, {
    key: 'componentDidUpdate',
    value: function componentDidUpdate(prevProps, prevState) {
      if (this.state.imageSize !== prevState.imageSize || this.state.imageX !== prevState.imageX || this.state.imageY !== prevState.imageY) {
        this.drawImage();
      }
    }
  }, {
    key: 'render',
    value: function render(_ref3, _ref4, _ref5) {
      var _classnames,
          _this3 = this;

      var dragging = _ref4.dragging;
      var options$$1 = _ref5.options;
      objectDestructuringEmpty(_ref3);
      var className = options$$1.className;

      return h(
        'div',
        null,
        h(
          'div',
          { 'class': classnames((_classnames = {}, defineProperty(_classnames, className + '-primaryBox', true), defineProperty(_classnames, 'is-dragging', dragging), _classnames)) },
          h('div', {
            'class': className + '-step2-canvas',
            ref: function ref($el) {
              return _this3.$preview = $el;
            }
          }),
          h('div', { 'class': className + '-step2-frame' }),
          h(
            MouseDragger,
            { onChange: this.handleMouseDraggerChange },
            h('div', { 'class': className + '-step2-actionBox' })
          ),
          h(
            'div',
            { 'class': className + '-step2-slider' },
            h(Slider$1, { onChange: this.onSliderChange })
          )
        ),
        h(
          PhotoBoxActionBar,
          null,
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between' } },
            h(
              PhotoBoxActionBarList,
              null,
              h(PhotoBoxActionBarItem, { isSelected: true, icon: 'crop' }),
              h(PhotoBoxActionBarItem, { isSelected: false, icon: 'filters' })
            ),
            h(
              PhotoBoxActionBarList,
              null,
              h(PhotoBoxActionBarItem, {
                isEmphasized: true,
                icon: 'check',
                onPress: this.handleSaveClick
              })
            )
          )
        )
      );
    }
  }]);
  return PhotoBoxStep2;
}(Component);

var PhotoBoxStep2$1 = withCSS(PhotoBoxStep2, css$3);

var css$4 = (function (_ref, _ref2) {
  var className = _ref.className,
      size = _ref.size,
      primaryColor = _ref.primaryColor,
      secondaryColor = _ref.secondaryColor;
  objectDestructuringEmpty(_ref2);
  return '\n  .' + className + '-step3 {\n    position: relative;\n    width: ' + size + 'px;\n    height: ' + size + 'px;\n  }\n  .' + className + '-step3-uploadBar {\n    position: absolute;\n    left: 0;\n    top: 0;\n    height: ' + size + 'px;\n    background-color: ' + rgba(secondaryColor, .75) + ';\n  }\n  .' + className + '-step3-uploadText {\n    position: absolute;\n    left: 0;\n    top: 50%;\n    transform: translateY(-50%);\n    width: 100%;\n    font-size: 100%;\n    font-weight: bold;\n    letter-spacing: 4px;\n    color: ' + rgba(primaryColor) + ';\n    text-shadow: 0 1px 4px ' + rgba(secondaryColor, .5) + ';\n    text-align: center;\n    text-transform: uppercase;\n  }\n';
});

var sendFile = function sendFile(_ref) {
  var url = _ref.url,
      file = _ref.file,
      onProgress = _ref.onProgress,
      onComplete = _ref.onComplete;

  var data = new FormData();
  data.append('avatar', file.blob, file.name);

  var xhr = new XMLHttpRequest();
  xhr.upload.addEventListener('progress', function (evt) {
    if (evt.lengthComputable) {
      var loaded = evt.loaded,
          total = evt.total;

      var percent = loaded / total;
      onProgress({ percent: percent, loaded: loaded, total: total });
    } else {
      console.warn('Length not computable from the server.');
    }
  }, false);
  xhr.upload.addEventListener('load', function (e) {
    console.log('upload done');
    onComplete({ e: e, status: xhr.status });
  });
  xhr.upload.addEventListener('error', function () {
    console.log('upload failed');
  });
  xhr.upload.addEventListener('abort', function () {
    console.log('upload aborted');
  });

  xhr.open('POST', url, true);
  xhr.send(data);
};

var PhotoBoxStep3 = function (_Component) {
  inherits(PhotoBoxStep3, _Component);

  function PhotoBoxStep3() {
    var _ref;

    classCallCheck(this, PhotoBoxStep3);

    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var _this = possibleConstructorReturn(this, (_ref = PhotoBoxStep3.__proto__ || Object.getPrototypeOf(PhotoBoxStep3)).call.apply(_ref, [this].concat(args)));

    _this.state = {
      progress: 0
    };
    return _this;
  }

  createClass(PhotoBoxStep3, [{
    key: 'componentDidMount',
    value: function componentDidMount() {
      var _this2 = this;

      var processedFile = this.props.processedFile;

      console.log('uploading processed file', processedFile);
      sendFile({
        url: 'http://localhost:9001/upload',
        file: processedFile,
        onProgress: function onProgress(_ref2) {
          var percent = _ref2.percent,
              loaded = _ref2.loaded,
              total = _ref2.total;

          console.log('upload progress', percent, loaded, total);
          _this2.setState({ progress: percent });
        },
        onComplete: function onComplete(_ref3) {
          var e = _ref3.e,
              status = _ref3.status;

          console.log('done', status);
          _this2.setState({ progress: 1 });
        }
      });
    }
  }, {
    key: 'render',
    value: function render(_ref4, _ref5, _ref6) {
      var processedFile = _ref4.processedFile;
      var progress = _ref5.progress;
      var options$$1 = _ref6.options;
      var className = options$$1.className;

      return h(
        'div',
        { 'class': className + '-step3' },
        h('img', { src: processedFile.base64 }),
        h('div', {
          'class': className + '-step3-uploadBar',
          style: { width: progress * 100 + '%' }
        }),
        h(
          'div',
          { 'class': className + '-step3-uploadText' },
          progress === 1 ? 'Uploaded' : 'Uploading'
        )
      );
    }
  }]);
  return PhotoBoxStep3;
}(Component);

var PhotoBoxStep3$1 = withCSS(PhotoBoxStep3, css$4);

var css$5 = (function (_ref, _ref2) {
  var className = _ref.className,
      size = _ref.size,
      primaryColor = _ref.primaryColor,
      secondaryColor = _ref.secondaryColor;
  objectDestructuringEmpty(_ref2);
  return '\n  .' + className + '-progress {\n    padding: 10px;\n    text-align: center;\n    border-top: 2px solid ' + rgba(secondaryColor, .1) + ';\n  }\n  .' + className + '-progressList {\n    list-style-type: none;\n    margin: 0;\n    font-size: 0;\n    padding-left: 0;\n  }\n  .' + className + '-progressList-item {\n    display: inline-block;\n    width: 6px;\n    height: 6px;\n    border-radius: 100%;\n    background-color: ' + rgba(secondaryColor, .25) + ';\n  }\n  .' + className + '-progressList-item:not(:last-child) {\n    margin-right: 4px;\n  }\n  .' + className + '-progressList-item.is-selected {\n    background-color: ' + rgba(secondaryColor) + ';\n  }\n';
});

var PhotoBoxProgress = function PhotoBoxProgress(_ref, _ref2) {
  var step = _ref.step;
  var options$$1 = _ref2.options;
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

var PhotoBoxProgress$1 = withCSS(PhotoBoxProgress, css$5);

var css$6 = (function (_ref, _ref2) {
  var className = _ref.className,
      size = _ref.size,
      primaryColor = _ref.primaryColor,
      secondaryColor = _ref.secondaryColor;
  objectDestructuringEmpty(_ref2);
  return '\n  .' + className + 'Container {\n    display: inline-block;\n    position: absolute;\n    opacity: 0;\n    font-family: inherit;\n    background-color: ' + rgba(primaryColor) + ';\n    border: 1px solid ' + rgba(secondaryColor, .25) + ';\n    border-radius: 3px;\n    box-shadow: 0 2px 20px rgba(0,0,0, .15);\n    transition: opacity .2s ease-in-out;\n    -webkit-user-select: none;\n       -moz-user-select: none;\n            user-select: none;\n  }\n  .' + className + ' {\n    position: relative;\n  }\n  .' + className + '-anchor {\n    display: inline-block;\n    position: absolute;\n    bottom: 100%;\n    bottom: calc(100% + 1px);\n    left: 50%;\n    transform: translateX(-50%);\n    width: 0;\n    height: 0;\n    border-color: transparent;\n    border-bottom-color: ' + rgba(secondaryColor, .25) + ';\n    border-style: solid;\n    border-width: 0 6px 6px 6px;\n  }\n  .' + className + '-primaryBox {\n    position: relative;\n    padding: 10px;\n    background-color: ' + rgba(secondaryColor, .1) + ';\n  }\n';
});

var PhotoBox$2 = function (_Component) {
  inherits(PhotoBox, _Component);

  function PhotoBox() {
    var _ref;

    classCallCheck(this, PhotoBox);

    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    var _this = possibleConstructorReturn(this, (_ref = PhotoBox.__proto__ || Object.getPrototypeOf(PhotoBox)).call.apply(_ref, [this].concat(args)));

    _this.state = {
      step: 1,
      selectedFile: null,
      processedFile: null
    };
    _this.selectFile = function (file) {
      _this.setState({ selectedFile: file, step: 2 });
    };
    _this.processFile = function (file) {
      _this.setState({ processedFile: file, step: 3 }, function () {
        _this.props.events.fire('position:target');
      });
    };
    return _this;
  }

  createClass(PhotoBox, [{
    key: 'getChildContext',
    value: function getChildContext() {
      return {
        options: this.props.options,
        events: this.props.events
      };
    }
  }, {
    key: 'render',
    value: function render(_ref2, _ref3) {
      var options$$1 = _ref2.options;
      var step = _ref3.step,
          selectedFile = _ref3.selectedFile,
          processedFile = _ref3.processedFile;
      var className = options$$1.className;

      return h(
        'div',
        { className: className },
        h(SVGSymbols, null),
        h('span', { 'class': className + '-anchor' }),
        step === 1 && h(PhotoBoxStep1$1, { selectFile: this.selectFile }),
        step === 2 && h(PhotoBoxStep2$1, {
          selectedFile: selectedFile,
          processFile: this.processFile
        }),
        step === 3 && h(PhotoBoxStep3$1, { processedFile: processedFile }),
        step !== 3 && h(PhotoBoxProgress$1, { step: step })
      );
    }
  }]);
  return PhotoBox;
}(Component);

var PhotoBoxComponent = withCSS(PhotoBox$2, css$6);

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
    var _this = this;

    var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    classCallCheck(this, PhotoBoxTarget);

    this.photoBox = photoBox;
    this.$target = $target;
    this.options = options;

    this._handleTargetClick = this._handleTargetClick.bind(this);
    this._handleWindowResize = this._handleWindowResize.bind(this);

    this.$target.addEventListener('click', this._handleTargetClick);
    window.addEventListener('resize', this._handleWindowResize);

    this.photoBox.events.on('position:target', function () {
      _this.position();
    });
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
      colors: {
        base: '#fff',
        accent: '#455054',
        emphasis: '#4c9501'
      },
      attachToTarget: null,
      className: 'PhotoBox',
      size: 240
    };
    this.opened = false;
    options$$1.size = Math.max(Math.min(320, options$$1.size), 120);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjpudWxsLCJzb3VyY2VzIjpbIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL3Zub2RlLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvb3B0aW9ucy5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL2guanMiLCIuLi9ub2RlX21vZHVsZXMvcHJlYWN0L3NyYy91dGlsLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvY2xvbmUtZWxlbWVudC5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL2NvbnN0YW50cy5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL2xpbmtlZC1zdGF0ZS5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL3JlbmRlci1xdWV1ZS5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL3Zkb20vZnVuY3Rpb25hbC1jb21wb25lbnQuanMiLCIuLi9ub2RlX21vZHVsZXMvcHJlYWN0L3NyYy92ZG9tL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvZG9tL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvZG9tL3JlY3ljbGVyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvdmRvbS9kaWZmLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ByZWFjdC9zcmMvdmRvbS9jb21wb25lbnQtcmVjeWNsZXIuanMiLCIuLi9ub2RlX21vZHVsZXMvcHJlYWN0L3NyYy92ZG9tL2NvbXBvbmVudC5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL2NvbXBvbmVudC5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcmVhY3Qvc3JjL3JlbmRlci5qcyIsIi4uL3NyYy91dGlsL0V2ZW50cy5qcyIsIi4uL3NyYy9jb21wb25lbnRzL1NWR1N5bWJvbHMuanMiLCIuLi9zcmMvY29tcG9uZW50cy9JY29uLmpzIiwiLi4vc3JjL3V0aWwvY29sb3IuanMiLCIuLi9zcmMvY29tcG9uZW50cy93aXRoQ1NTLmpzIiwiLi4vc3JjL3V0aWwvY2xhc3NuYW1lcy5qcyIsIi4uL3NyYy9jb21wb25lbnRzL1Bob3RvQm94QWN0aW9uQmFyL1Bob3RvQm94QWN0aW9uQmFyLmNzcy5qcyIsIi4uL3NyYy9jb21wb25lbnRzL1Bob3RvQm94QWN0aW9uQmFyL1Bob3RvQm94QWN0aW9uQmFyLmpzIiwiLi4vc3JjL2NvbXBvbmVudHMvUGhvdG9Cb3hTdGVwMS9QaG90b0JveFN0ZXAxLmNzcy5qcyIsIi4uL3NyYy91dGlsL2Jsb2IuanMiLCIuLi9zcmMvY29tcG9uZW50cy9QaG90b0JveFN0ZXAxL1Bob3RvQm94U3RlcDEuanMiLCIuLi9zcmMvY29tcG9uZW50cy9Nb3VzZU1vdmVyLmpzIiwiLi4vc3JjL2NvbXBvbmVudHMvU2xpZGVyL1NsaWRlci5jc3MuanMiLCIuLi9zcmMvY29tcG9uZW50cy9TbGlkZXIvU2xpZGVyLmpzIiwiLi4vc3JjL2NvbXBvbmVudHMvTW91c2VEcmFnZ2VyLmpzIiwiLi4vc3JjL2NvbXBvbmVudHMvUGhvdG9Cb3hTdGVwMi9QaG90b0JveFN0ZXAyLmNzcy5qcyIsIi4uL3NyYy9jb21wb25lbnRzL1Bob3RvQm94U3RlcDIvUGhvdG9Cb3hTdGVwMi5qcyIsIi4uL3NyYy9jb21wb25lbnRzL1Bob3RvQm94U3RlcDMvUGhvdG9Cb3hTdGVwMy5jc3MuanMiLCIuLi9zcmMvdXRpbC94aHIuanMiLCIuLi9zcmMvY29tcG9uZW50cy9QaG90b0JveFN0ZXAzL1Bob3RvQm94U3RlcDMuanMiLCIuLi9zcmMvY29tcG9uZW50cy9QaG90b0JveFByb2dyZXNzL1Bob3RvQm94UHJvZ3Jlc3MuY3NzLmpzIiwiLi4vc3JjL2NvbXBvbmVudHMvUGhvdG9Cb3hQcm9ncmVzcy9QaG90b0JveFByb2dyZXNzLmpzIiwiLi4vc3JjL2NvbXBvbmVudHMvUGhvdG9Cb3gvUGhvdG9Cb3guY3NzLmpzIiwiLi4vc3JjL2NvbXBvbmVudHMvUGhvdG9Cb3gvUGhvdG9Cb3guanMiLCIuLi9zcmMvUGhvdG9Cb3hUYXJnZXQuanMiLCIuLi9zcmMvUGhvdG9Cb3guanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqIFZpcnR1YWwgRE9NIE5vZGUgKi9cbmV4cG9ydCBmdW5jdGlvbiBWTm9kZShub2RlTmFtZSwgYXR0cmlidXRlcywgY2hpbGRyZW4pIHtcblx0LyoqIEB0eXBlIHtzdHJpbmd8ZnVuY3Rpb259ICovXG5cdHRoaXMubm9kZU5hbWUgPSBub2RlTmFtZTtcblxuXHQvKiogQHR5cGUge29iamVjdDxzdHJpbmc+fHVuZGVmaW5lZH0gKi9cblx0dGhpcy5hdHRyaWJ1dGVzID0gYXR0cmlidXRlcztcblxuXHQvKiogQHR5cGUge2FycmF5PFZOb2RlPnx1bmRlZmluZWR9ICovXG5cdHRoaXMuY2hpbGRyZW4gPSBjaGlsZHJlbjtcblxuXHQvKiogUmVmZXJlbmNlIHRvIHRoZSBnaXZlbiBrZXkuICovXG5cdHRoaXMua2V5ID0gYXR0cmlidXRlcyAmJiBhdHRyaWJ1dGVzLmtleTtcbn1cbiIsIi8qKiBHbG9iYWwgb3B0aW9uc1xuICpcdEBwdWJsaWNcbiAqXHRAbmFtZXNwYWNlIG9wdGlvbnMge09iamVjdH1cbiAqL1xuZXhwb3J0IGRlZmF1bHQge1xuXG5cdC8qKiBJZiBgdHJ1ZWAsIGBwcm9wYCBjaGFuZ2VzIHRyaWdnZXIgc3luY2hyb25vdXMgY29tcG9uZW50IHVwZGF0ZXMuXG5cdCAqXHRAbmFtZSBzeW5jQ29tcG9uZW50VXBkYXRlc1xuXHQgKlx0QHR5cGUgQm9vbGVhblxuXHQgKlx0QGRlZmF1bHQgdHJ1ZVxuXHQgKi9cblx0Ly9zeW5jQ29tcG9uZW50VXBkYXRlczogdHJ1ZSxcblxuXHQvKiogUHJvY2Vzc2VzIGFsbCBjcmVhdGVkIFZOb2Rlcy5cblx0ICpcdEBwYXJhbSB7Vk5vZGV9IHZub2RlXHRBIG5ld2x5LWNyZWF0ZWQgVk5vZGUgdG8gbm9ybWFsaXplL3Byb2Nlc3Ncblx0ICovXG5cdC8vdm5vZGUodm5vZGUpIHsgfVxuXG5cdC8qKiBIb29rIGludm9rZWQgYWZ0ZXIgYSBjb21wb25lbnQgaXMgbW91bnRlZC4gKi9cblx0Ly8gYWZ0ZXJNb3VudChjb21wb25lbnQpIHsgfVxuXG5cdC8qKiBIb29rIGludm9rZWQgYWZ0ZXIgdGhlIERPTSBpcyB1cGRhdGVkIHdpdGggYSBjb21wb25lbnQncyBsYXRlc3QgcmVuZGVyLiAqL1xuXHQvLyBhZnRlclVwZGF0ZShjb21wb25lbnQpIHsgfVxuXG5cdC8qKiBIb29rIGludm9rZWQgaW1tZWRpYXRlbHkgYmVmb3JlIGEgY29tcG9uZW50IGlzIHVubW91bnRlZC4gKi9cblx0Ly8gYmVmb3JlVW5tb3VudChjb21wb25lbnQpIHsgfVxufTtcbiIsImltcG9ydCB7IFZOb2RlIH0gZnJvbSAnLi92bm9kZSc7XG5pbXBvcnQgb3B0aW9ucyBmcm9tICcuL29wdGlvbnMnO1xuXG5cbmNvbnN0IHN0YWNrID0gW107XG5cblxuLyoqIEpTWC9oeXBlcnNjcmlwdCByZXZpdmVyXG4qXHRCZW5jaG1hcmtzOiBodHRwczovL2VzYmVuY2guY29tL2JlbmNoLzU3ZWU4ZjhlMzMwYWIwOTkwMGExYTFhMFxuICpcdEBzZWUgaHR0cDovL2phc29uZm9ybWF0LmNvbS93dGYtaXMtanN4XG4gKlx0QHB1YmxpY1xuICogIEBleGFtcGxlXG4gKiAgLyoqIEBqc3ggaCAqXFwvXG4gKiAgaW1wb3J0IHsgcmVuZGVyLCBoIH0gZnJvbSAncHJlYWN0JztcbiAqICByZW5kZXIoPHNwYW4+Zm9vPC9zcGFuPiwgZG9jdW1lbnQuYm9keSk7XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoKG5vZGVOYW1lLCBhdHRyaWJ1dGVzKSB7XG5cdGxldCBjaGlsZHJlbiA9IFtdLFxuXHRcdGxhc3RTaW1wbGUsIGNoaWxkLCBzaW1wbGUsIGk7XG5cdGZvciAoaT1hcmd1bWVudHMubGVuZ3RoOyBpLS0gPiAyOyApIHtcblx0XHRzdGFjay5wdXNoKGFyZ3VtZW50c1tpXSk7XG5cdH1cblx0aWYgKGF0dHJpYnV0ZXMgJiYgYXR0cmlidXRlcy5jaGlsZHJlbikge1xuXHRcdGlmICghc3RhY2subGVuZ3RoKSBzdGFjay5wdXNoKGF0dHJpYnV0ZXMuY2hpbGRyZW4pO1xuXHRcdGRlbGV0ZSBhdHRyaWJ1dGVzLmNoaWxkcmVuO1xuXHR9XG5cdHdoaWxlIChzdGFjay5sZW5ndGgpIHtcblx0XHRpZiAoKGNoaWxkID0gc3RhY2sucG9wKCkpIGluc3RhbmNlb2YgQXJyYXkpIHtcblx0XHRcdGZvciAoaT1jaGlsZC5sZW5ndGg7IGktLTsgKSBzdGFjay5wdXNoKGNoaWxkW2ldKTtcblx0XHR9XG5cdFx0ZWxzZSBpZiAoY2hpbGQhPW51bGwgJiYgY2hpbGQhPT1mYWxzZSkge1xuXHRcdFx0aWYgKHR5cGVvZiBjaGlsZD09J251bWJlcicgfHwgY2hpbGQ9PT10cnVlKSBjaGlsZCA9IFN0cmluZyhjaGlsZCk7XG5cdFx0XHRzaW1wbGUgPSB0eXBlb2YgY2hpbGQ9PSdzdHJpbmcnO1xuXHRcdFx0aWYgKHNpbXBsZSAmJiBsYXN0U2ltcGxlKSB7XG5cdFx0XHRcdGNoaWxkcmVuW2NoaWxkcmVuLmxlbmd0aC0xXSArPSBjaGlsZDtcblx0XHRcdH1cblx0XHRcdGVsc2Uge1xuXHRcdFx0XHRjaGlsZHJlbi5wdXNoKGNoaWxkKTtcblx0XHRcdFx0bGFzdFNpbXBsZSA9IHNpbXBsZTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRsZXQgcCA9IG5ldyBWTm9kZShub2RlTmFtZSwgYXR0cmlidXRlcyB8fCB1bmRlZmluZWQsIGNoaWxkcmVuKTtcblxuXHQvLyBpZiBhIFwidm5vZGUgaG9va1wiIGlzIGRlZmluZWQsIHBhc3MgZXZlcnkgY3JlYXRlZCBWTm9kZSB0byBpdFxuXHRpZiAob3B0aW9ucy52bm9kZSkgb3B0aW9ucy52bm9kZShwKTtcblxuXHRyZXR1cm4gcDtcbn1cbiIsIi8qKiBDb3B5IG93bi1wcm9wZXJ0aWVzIGZyb20gYHByb3BzYCBvbnRvIGBvYmpgLlxuICpcdEByZXR1cm5zIG9ialxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRlbmQob2JqLCBwcm9wcykge1xuXHRpZiAocHJvcHMpIHtcblx0XHRmb3IgKGxldCBpIGluIHByb3BzKSBvYmpbaV0gPSBwcm9wc1tpXTtcblx0fVxuXHRyZXR1cm4gb2JqO1xufVxuXG5cbi8qKiBGYXN0IGNsb25lLiBOb3RlOiBkb2VzIG5vdCBmaWx0ZXIgb3V0IG5vbi1vd24gcHJvcGVydGllcy5cbiAqXHRAc2VlIGh0dHBzOi8vZXNiZW5jaC5jb20vYmVuY2gvNTZiYWEzNGY0NWRmNjg5NTAwMmUwM2I2XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbG9uZShvYmopIHtcblx0cmV0dXJuIGV4dGVuZCh7fSwgb2JqKTtcbn1cblxuXG4vKiogR2V0IGEgZGVlcCBwcm9wZXJ0eSB2YWx1ZSBmcm9tIHRoZSBnaXZlbiBvYmplY3QsIGV4cHJlc3NlZCBpbiBkb3Qtbm90YXRpb24uXG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlbHZlKG9iaiwga2V5KSB7XG5cdGZvciAobGV0IHA9a2V5LnNwbGl0KCcuJyksIGk9MDsgaTxwLmxlbmd0aCAmJiBvYmo7IGkrKykge1xuXHRcdG9iaiA9IG9ialtwW2ldXTtcblx0fVxuXHRyZXR1cm4gb2JqO1xufVxuXG5cbi8qKiBAcHJpdmF0ZSBpcyB0aGUgZ2l2ZW4gb2JqZWN0IGEgRnVuY3Rpb24/ICovXG5leHBvcnQgZnVuY3Rpb24gaXNGdW5jdGlvbihvYmopIHtcblx0cmV0dXJuICdmdW5jdGlvbic9PT10eXBlb2Ygb2JqO1xufVxuXG5cbi8qKiBAcHJpdmF0ZSBpcyB0aGUgZ2l2ZW4gb2JqZWN0IGEgU3RyaW5nPyAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3RyaW5nKG9iaikge1xuXHRyZXR1cm4gJ3N0cmluZyc9PT10eXBlb2Ygb2JqO1xufVxuXG5cbi8qKiBDb252ZXJ0IGEgaGFzaG1hcCBvZiBDU1MgY2xhc3NlcyB0byBhIHNwYWNlLWRlbGltaXRlZCBjbGFzc05hbWUgc3RyaW5nXG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGhhc2hUb0NsYXNzTmFtZShjKSB7XG5cdGxldCBzdHIgPSAnJztcblx0Zm9yIChsZXQgcHJvcCBpbiBjKSB7XG5cdFx0aWYgKGNbcHJvcF0pIHtcblx0XHRcdGlmIChzdHIpIHN0ciArPSAnICc7XG5cdFx0XHRzdHIgKz0gcHJvcDtcblx0XHR9XG5cdH1cblx0cmV0dXJuIHN0cjtcbn1cblxuXG4vKiogSnVzdCBhIG1lbW9pemVkIFN0cmluZyN0b0xvd2VyQ2FzZSAqL1xubGV0IGxjQ2FjaGUgPSB7fTtcbmV4cG9ydCBjb25zdCB0b0xvd2VyQ2FzZSA9IHMgPT4gbGNDYWNoZVtzXSB8fCAobGNDYWNoZVtzXSA9IHMudG9Mb3dlckNhc2UoKSk7XG5cblxuLyoqIENhbGwgYSBmdW5jdGlvbiBhc3luY2hyb25vdXNseSwgYXMgc29vbiBhcyBwb3NzaWJsZS5cbiAqXHRAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICovXG5sZXQgcmVzb2x2ZWQgPSB0eXBlb2YgUHJvbWlzZSE9PSd1bmRlZmluZWQnICYmIFByb21pc2UucmVzb2x2ZSgpO1xuZXhwb3J0IGNvbnN0IGRlZmVyID0gcmVzb2x2ZWQgPyAoZiA9PiB7IHJlc29sdmVkLnRoZW4oZik7IH0pIDogc2V0VGltZW91dDtcbiIsImltcG9ydCB7IGNsb25lLCBleHRlbmQgfSBmcm9tICcuL3V0aWwnO1xuaW1wb3J0IHsgaCB9IGZyb20gJy4vaCc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjbG9uZUVsZW1lbnQodm5vZGUsIHByb3BzKSB7XG5cdHJldHVybiBoKFxuXHRcdHZub2RlLm5vZGVOYW1lLFxuXHRcdGV4dGVuZChjbG9uZSh2bm9kZS5hdHRyaWJ1dGVzKSwgcHJvcHMpLFxuXHRcdGFyZ3VtZW50cy5sZW5ndGg+MiA/IFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKSA6IHZub2RlLmNoaWxkcmVuXG5cdCk7XG59XG4iLCIvLyByZW5kZXIgbW9kZXNcblxuZXhwb3J0IGNvbnN0IE5PX1JFTkRFUiA9IDA7XG5leHBvcnQgY29uc3QgU1lOQ19SRU5ERVIgPSAxO1xuZXhwb3J0IGNvbnN0IEZPUkNFX1JFTkRFUiA9IDI7XG5leHBvcnQgY29uc3QgQVNZTkNfUkVOREVSID0gMztcblxuZXhwb3J0IGNvbnN0IEVNUFRZID0ge307XG5cbmV4cG9ydCBjb25zdCBBVFRSX0tFWSA9IHR5cGVvZiBTeW1ib2whPT0ndW5kZWZpbmVkJyA/IFN5bWJvbC5mb3IoJ3ByZWFjdGF0dHInKSA6ICdfX3ByZWFjdGF0dHJfJztcblxuLy8gRE9NIHByb3BlcnRpZXMgdGhhdCBzaG91bGQgTk9UIGhhdmUgXCJweFwiIGFkZGVkIHdoZW4gbnVtZXJpY1xuZXhwb3J0IGNvbnN0IE5PTl9ESU1FTlNJT05fUFJPUFMgPSB7XG5cdGJveEZsZXg6MSwgYm94RmxleEdyb3VwOjEsIGNvbHVtbkNvdW50OjEsIGZpbGxPcGFjaXR5OjEsIGZsZXg6MSwgZmxleEdyb3c6MSxcblx0ZmxleFBvc2l0aXZlOjEsIGZsZXhTaHJpbms6MSwgZmxleE5lZ2F0aXZlOjEsIGZvbnRXZWlnaHQ6MSwgbGluZUNsYW1wOjEsIGxpbmVIZWlnaHQ6MSxcblx0b3BhY2l0eToxLCBvcmRlcjoxLCBvcnBoYW5zOjEsIHN0cm9rZU9wYWNpdHk6MSwgd2lkb3dzOjEsIHpJbmRleDoxLCB6b29tOjFcbn07XG5cbi8vIERPTSBldmVudCB0eXBlcyB0aGF0IGRvIG5vdCBidWJibGUgYW5kIHNob3VsZCBiZSBhdHRhY2hlZCB2aWEgdXNlQ2FwdHVyZVxuZXhwb3J0IGNvbnN0IE5PTl9CVUJCTElOR19FVkVOVFMgPSB7IGJsdXI6MSwgZXJyb3I6MSwgZm9jdXM6MSwgbG9hZDoxLCByZXNpemU6MSwgc2Nyb2xsOjEgfTtcbiIsImltcG9ydCB7IGlzU3RyaW5nLCBkZWx2ZSB9IGZyb20gJy4vdXRpbCc7XG5cbi8qKiBDcmVhdGUgYW4gRXZlbnQgaGFuZGxlciBmdW5jdGlvbiB0aGF0IHNldHMgYSBnaXZlbiBzdGF0ZSBwcm9wZXJ0eS5cbiAqXHRAcGFyYW0ge0NvbXBvbmVudH0gY29tcG9uZW50XHRUaGUgY29tcG9uZW50IHdob3NlIHN0YXRlIHNob3VsZCBiZSB1cGRhdGVkXG4gKlx0QHBhcmFtIHtzdHJpbmd9IGtleVx0XHRcdFx0QSBkb3Qtbm90YXRlZCBrZXkgcGF0aCB0byB1cGRhdGUgaW4gdGhlIGNvbXBvbmVudCdzIHN0YXRlXG4gKlx0QHBhcmFtIHtzdHJpbmd9IGV2ZW50UGF0aFx0XHRBIGRvdC1ub3RhdGVkIGtleSBwYXRoIHRvIHRoZSB2YWx1ZSB0aGF0IHNob3VsZCBiZSByZXRyaWV2ZWQgZnJvbSB0aGUgRXZlbnQgb3IgY29tcG9uZW50XG4gKlx0QHJldHVybnMge2Z1bmN0aW9ufSBsaW5rZWRTdGF0ZUhhbmRsZXJcbiAqXHRAcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTGlua2VkU3RhdGUoY29tcG9uZW50LCBrZXksIGV2ZW50UGF0aCkge1xuXHRsZXQgcGF0aCA9IGtleS5zcGxpdCgnLicpO1xuXHRyZXR1cm4gZnVuY3Rpb24oZSkge1xuXHRcdGxldCB0ID0gZSAmJiBlLnRhcmdldCB8fCB0aGlzLFxuXHRcdFx0c3RhdGUgPSB7fSxcblx0XHRcdG9iaiA9IHN0YXRlLFxuXHRcdFx0diA9IGlzU3RyaW5nKGV2ZW50UGF0aCkgPyBkZWx2ZShlLCBldmVudFBhdGgpIDogdC5ub2RlTmFtZSA/ICh0LnR5cGUubWF0Y2goL15jaGV8cmFkLykgPyB0LmNoZWNrZWQgOiB0LnZhbHVlKSA6IGUsXG5cdFx0XHRpID0gMDtcblx0XHRmb3IgKCA7IGk8cGF0aC5sZW5ndGgtMTsgaSsrKSB7XG5cdFx0XHRvYmogPSBvYmpbcGF0aFtpXV0gfHwgKG9ialtwYXRoW2ldXSA9ICFpICYmIGNvbXBvbmVudC5zdGF0ZVtwYXRoW2ldXSB8fCB7fSk7XG5cdFx0fVxuXHRcdG9ialtwYXRoW2ldXSA9IHY7XG5cdFx0Y29tcG9uZW50LnNldFN0YXRlKHN0YXRlKTtcblx0fTtcbn1cbiIsImltcG9ydCBvcHRpb25zIGZyb20gJy4vb3B0aW9ucyc7XG5pbXBvcnQgeyBkZWZlciB9IGZyb20gJy4vdXRpbCc7XG5pbXBvcnQgeyByZW5kZXJDb21wb25lbnQgfSBmcm9tICcuL3Zkb20vY29tcG9uZW50JztcblxuLyoqIE1hbmFnZWQgcXVldWUgb2YgZGlydHkgY29tcG9uZW50cyB0byBiZSByZS1yZW5kZXJlZCAqL1xuXG4vLyBpdGVtcy9pdGVtc09mZmxpbmUgc3dhcCBvbiBlYWNoIHJlcmVuZGVyKCkgY2FsbCAoanVzdCBhIHNpbXBsZSBwb29sIHRlY2huaXF1ZSlcbmxldCBpdGVtcyA9IFtdO1xuXG5leHBvcnQgZnVuY3Rpb24gZW5xdWV1ZVJlbmRlcihjb21wb25lbnQpIHtcblx0aWYgKCFjb21wb25lbnQuX2RpcnR5ICYmIChjb21wb25lbnQuX2RpcnR5ID0gdHJ1ZSkgJiYgaXRlbXMucHVzaChjb21wb25lbnQpPT0xKSB7XG5cdFx0KG9wdGlvbnMuZGVib3VuY2VSZW5kZXJpbmcgfHwgZGVmZXIpKHJlcmVuZGVyKTtcblx0fVxufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiByZXJlbmRlcigpIHtcblx0bGV0IHAsIGxpc3QgPSBpdGVtcztcblx0aXRlbXMgPSBbXTtcblx0d2hpbGUgKCAocCA9IGxpc3QucG9wKCkpICkge1xuXHRcdGlmIChwLl9kaXJ0eSkgcmVuZGVyQ29tcG9uZW50KHApO1xuXHR9XG59XG4iLCJpbXBvcnQgeyBFTVBUWSB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgeyBnZXROb2RlUHJvcHMgfSBmcm9tICcuL2luZGV4JztcbmltcG9ydCB7IGlzRnVuY3Rpb24gfSBmcm9tICcuLi91dGlsJztcblxuXG4vKiogQ2hlY2sgaWYgYSBWTm9kZSBpcyBhIHJlZmVyZW5jZSB0byBhIHN0YXRlbGVzcyBmdW5jdGlvbmFsIGNvbXBvbmVudC5cbiAqXHRBIGZ1bmN0aW9uIGNvbXBvbmVudCBpcyByZXByZXNlbnRlZCBhcyBhIFZOb2RlIHdob3NlIGBub2RlTmFtZWAgcHJvcGVydHkgaXMgYSByZWZlcmVuY2UgdG8gYSBmdW5jdGlvbi5cbiAqXHRJZiB0aGF0IGZ1bmN0aW9uIGlzIG5vdCBhIENvbXBvbmVudCAoaWUsIGhhcyBubyBgLnJlbmRlcigpYCBtZXRob2Qgb24gYSBwcm90b3R5cGUpLCBpdCBpcyBjb25zaWRlcmVkIGEgc3RhdGVsZXNzIGZ1bmN0aW9uYWwgY29tcG9uZW50LlxuICpcdEBwYXJhbSB7Vk5vZGV9IHZub2RlXHRBIFZOb2RlXG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRnVuY3Rpb25hbENvbXBvbmVudCh2bm9kZSkge1xuXHRsZXQgbm9kZU5hbWUgPSB2bm9kZSAmJiB2bm9kZS5ub2RlTmFtZTtcblx0cmV0dXJuIG5vZGVOYW1lICYmIGlzRnVuY3Rpb24obm9kZU5hbWUpICYmICEobm9kZU5hbWUucHJvdG90eXBlICYmIG5vZGVOYW1lLnByb3RvdHlwZS5yZW5kZXIpO1xufVxuXG5cblxuLyoqIENvbnN0cnVjdCBhIHJlc3VsdGFudCBWTm9kZSBmcm9tIGEgVk5vZGUgcmVmZXJlbmNpbmcgYSBzdGF0ZWxlc3MgZnVuY3Rpb25hbCBjb21wb25lbnQuXG4gKlx0QHBhcmFtIHtWTm9kZX0gdm5vZGVcdEEgVk5vZGUgd2l0aCBhIGBub2RlTmFtZWAgcHJvcGVydHkgdGhhdCBpcyBhIHJlZmVyZW5jZSB0byBhIGZ1bmN0aW9uLlxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEZ1bmN0aW9uYWxDb21wb25lbnQodm5vZGUsIGNvbnRleHQpIHtcblx0cmV0dXJuIHZub2RlLm5vZGVOYW1lKGdldE5vZGVQcm9wcyh2bm9kZSksIGNvbnRleHQgfHwgRU1QVFkpO1xufVxuIiwiaW1wb3J0IHsgY2xvbmUsIGlzU3RyaW5nLCBpc0Z1bmN0aW9uLCB0b0xvd2VyQ2FzZSB9IGZyb20gJy4uL3V0aWwnO1xuaW1wb3J0IHsgaXNGdW5jdGlvbmFsQ29tcG9uZW50IH0gZnJvbSAnLi9mdW5jdGlvbmFsLWNvbXBvbmVudCc7XG5cblxuLyoqIENoZWNrIGlmIHR3byBub2RlcyBhcmUgZXF1aXZhbGVudC5cbiAqXHRAcGFyYW0ge0VsZW1lbnR9IG5vZGVcbiAqXHRAcGFyYW0ge1ZOb2RlfSB2bm9kZVxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NhbWVOb2RlVHlwZShub2RlLCB2bm9kZSkge1xuXHRpZiAoaXNTdHJpbmcodm5vZGUpKSB7XG5cdFx0cmV0dXJuIG5vZGUgaW5zdGFuY2VvZiBUZXh0O1xuXHR9XG5cdGlmIChpc1N0cmluZyh2bm9kZS5ub2RlTmFtZSkpIHtcblx0XHRyZXR1cm4gIW5vZGUuX2NvbXBvbmVudENvbnN0cnVjdG9yICYmIGlzTmFtZWROb2RlKG5vZGUsIHZub2RlLm5vZGVOYW1lKTtcblx0fVxuXHRpZiAoaXNGdW5jdGlvbih2bm9kZS5ub2RlTmFtZSkpIHtcblx0XHRyZXR1cm4gKG5vZGUuX2NvbXBvbmVudENvbnN0cnVjdG9yID8gbm9kZS5fY29tcG9uZW50Q29uc3RydWN0b3I9PT12bm9kZS5ub2RlTmFtZSA6IHRydWUpIHx8IGlzRnVuY3Rpb25hbENvbXBvbmVudCh2bm9kZSk7XG5cdH1cbn1cblxuXG5leHBvcnQgZnVuY3Rpb24gaXNOYW1lZE5vZGUobm9kZSwgbm9kZU5hbWUpIHtcblx0cmV0dXJuIG5vZGUubm9ybWFsaXplZE5vZGVOYW1lPT09bm9kZU5hbWUgfHwgdG9Mb3dlckNhc2Uobm9kZS5ub2RlTmFtZSk9PT10b0xvd2VyQ2FzZShub2RlTmFtZSk7XG59XG5cblxuLyoqXG4gKiBSZWNvbnN0cnVjdCBDb21wb25lbnQtc3R5bGUgYHByb3BzYCBmcm9tIGEgVk5vZGUuXG4gKiBFbnN1cmVzIGRlZmF1bHQvZmFsbGJhY2sgdmFsdWVzIGZyb20gYGRlZmF1bHRQcm9wc2A6XG4gKiBPd24tcHJvcGVydGllcyBvZiBgZGVmYXVsdFByb3BzYCBub3QgcHJlc2VudCBpbiBgdm5vZGUuYXR0cmlidXRlc2AgYXJlIGFkZGVkLlxuICogQHBhcmFtIHtWTm9kZX0gdm5vZGVcbiAqIEByZXR1cm5zIHtPYmplY3R9IHByb3BzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXROb2RlUHJvcHModm5vZGUpIHtcblx0bGV0IHByb3BzID0gY2xvbmUodm5vZGUuYXR0cmlidXRlcyk7XG5cdHByb3BzLmNoaWxkcmVuID0gdm5vZGUuY2hpbGRyZW47XG5cblx0bGV0IGRlZmF1bHRQcm9wcyA9IHZub2RlLm5vZGVOYW1lLmRlZmF1bHRQcm9wcztcblx0aWYgKGRlZmF1bHRQcm9wcykge1xuXHRcdGZvciAobGV0IGkgaW4gZGVmYXVsdFByb3BzKSB7XG5cdFx0XHRpZiAocHJvcHNbaV09PT11bmRlZmluZWQpIHtcblx0XHRcdFx0cHJvcHNbaV0gPSBkZWZhdWx0UHJvcHNbaV07XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHByb3BzO1xufVxuIiwiaW1wb3J0IHsgTk9OX0RJTUVOU0lPTl9QUk9QUywgTk9OX0JVQkJMSU5HX0VWRU5UUyB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgb3B0aW9ucyBmcm9tICcuLi9vcHRpb25zJztcbmltcG9ydCB7IHRvTG93ZXJDYXNlLCBpc1N0cmluZywgaXNGdW5jdGlvbiwgaGFzaFRvQ2xhc3NOYW1lIH0gZnJvbSAnLi4vdXRpbCc7XG5cblxuXG5cbi8qKiBSZW1vdmVzIGEgZ2l2ZW4gRE9NIE5vZGUgZnJvbSBpdHMgcGFyZW50LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZU5vZGUobm9kZSkge1xuXHRsZXQgcCA9IG5vZGUucGFyZW50Tm9kZTtcblx0aWYgKHApIHAucmVtb3ZlQ2hpbGQobm9kZSk7XG59XG5cblxuLyoqIFNldCBhIG5hbWVkIGF0dHJpYnV0ZSBvbiB0aGUgZ2l2ZW4gTm9kZSwgd2l0aCBzcGVjaWFsIGJlaGF2aW9yIGZvciBzb21lIG5hbWVzIGFuZCBldmVudCBoYW5kbGVycy5cbiAqXHRJZiBgdmFsdWVgIGlzIGBudWxsYCwgdGhlIGF0dHJpYnV0ZS9oYW5kbGVyIHdpbGwgYmUgcmVtb3ZlZC5cbiAqXHRAcGFyYW0ge0VsZW1lbnR9IG5vZGVcdEFuIGVsZW1lbnQgdG8gbXV0YXRlXG4gKlx0QHBhcmFtIHtzdHJpbmd9IG5hbWVcdFRoZSBuYW1lL2tleSB0byBzZXQsIHN1Y2ggYXMgYW4gZXZlbnQgb3IgYXR0cmlidXRlIG5hbWVcbiAqXHRAcGFyYW0ge2FueX0gdmFsdWVcdFx0QW4gYXR0cmlidXRlIHZhbHVlLCBzdWNoIGFzIGEgZnVuY3Rpb24gdG8gYmUgdXNlZCBhcyBhbiBldmVudCBoYW5kbGVyXG4gKlx0QHBhcmFtIHthbnl9IHByZXZpb3VzVmFsdWVcdFRoZSBsYXN0IHZhbHVlIHRoYXQgd2FzIHNldCBmb3IgdGhpcyBuYW1lL25vZGUgcGFpclxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRBY2Nlc3Nvcihub2RlLCBuYW1lLCBvbGQsIHZhbHVlLCBpc1N2Zykge1xuXG5cdGlmIChuYW1lPT09J2NsYXNzTmFtZScpIG5hbWUgPSAnY2xhc3MnO1xuXG5cdGlmIChuYW1lPT09J2NsYXNzJyAmJiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWU9PT0nb2JqZWN0Jykge1xuXHRcdHZhbHVlID0gaGFzaFRvQ2xhc3NOYW1lKHZhbHVlKTtcblx0fVxuXG5cdGlmIChuYW1lPT09J2tleScpIHtcblx0XHQvLyBpZ25vcmVcblx0fVxuXHRlbHNlIGlmIChuYW1lPT09J2NsYXNzJyAmJiAhaXNTdmcpIHtcblx0XHRub2RlLmNsYXNzTmFtZSA9IHZhbHVlIHx8ICcnO1xuXHR9XG5cdGVsc2UgaWYgKG5hbWU9PT0nc3R5bGUnKSB7XG5cdFx0aWYgKCF2YWx1ZSB8fCBpc1N0cmluZyh2YWx1ZSkgfHwgaXNTdHJpbmcob2xkKSkge1xuXHRcdFx0bm9kZS5zdHlsZS5jc3NUZXh0ID0gdmFsdWUgfHwgJyc7XG5cdFx0fVxuXHRcdGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWU9PT0nb2JqZWN0Jykge1xuXHRcdFx0aWYgKCFpc1N0cmluZyhvbGQpKSB7XG5cdFx0XHRcdGZvciAobGV0IGkgaW4gb2xkKSBpZiAoIShpIGluIHZhbHVlKSkgbm9kZS5zdHlsZVtpXSA9ICcnO1xuXHRcdFx0fVxuXHRcdFx0Zm9yIChsZXQgaSBpbiB2YWx1ZSkge1xuXHRcdFx0XHRub2RlLnN0eWxlW2ldID0gdHlwZW9mIHZhbHVlW2ldPT09J251bWJlcicgJiYgIU5PTl9ESU1FTlNJT05fUFJPUFNbaV0gPyAodmFsdWVbaV0rJ3B4JykgOiB2YWx1ZVtpXTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblx0ZWxzZSBpZiAobmFtZT09PSdkYW5nZXJvdXNseVNldElubmVySFRNTCcpIHtcblx0XHRub2RlLmlubmVySFRNTCA9IHZhbHVlICYmIHZhbHVlLl9faHRtbCB8fCAnJztcblx0fVxuXHRlbHNlIGlmIChuYW1lWzBdPT0nbycgJiYgbmFtZVsxXT09J24nKSB7XG5cdFx0bGV0IGwgPSBub2RlLl9saXN0ZW5lcnMgfHwgKG5vZGUuX2xpc3RlbmVycyA9IHt9KTtcblx0XHRuYW1lID0gdG9Mb3dlckNhc2UobmFtZS5zdWJzdHJpbmcoMikpO1xuXHRcdC8vIEBUT0RPOiB0aGlzIG1pZ2h0IGJlIHdvcnRoIGl0IGxhdGVyLCB1bi1icmVha3MgZm9jdXMvYmx1ciBidWJibGluZyBpbiBJRTk6XG5cdFx0Ly8gaWYgKG5vZGUuYXR0YWNoRXZlbnQpIG5hbWUgPSBuYW1lPT0nZm9jdXMnPydmb2N1c2luJzpuYW1lPT0nYmx1cic/J2ZvY3Vzb3V0JzpuYW1lO1xuXHRcdGlmICh2YWx1ZSkge1xuXHRcdFx0aWYgKCFsW25hbWVdKSBub2RlLmFkZEV2ZW50TGlzdGVuZXIobmFtZSwgZXZlbnRQcm94eSwgISFOT05fQlVCQkxJTkdfRVZFTlRTW25hbWVdKTtcblx0XHR9XG5cdFx0ZWxzZSBpZiAobFtuYW1lXSkge1xuXHRcdFx0bm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKG5hbWUsIGV2ZW50UHJveHksICEhTk9OX0JVQkJMSU5HX0VWRU5UU1tuYW1lXSk7XG5cdFx0fVxuXHRcdGxbbmFtZV0gPSB2YWx1ZTtcblx0fVxuXHRlbHNlIGlmIChuYW1lIT09J2xpc3QnICYmIG5hbWUhPT0ndHlwZScgJiYgIWlzU3ZnICYmIG5hbWUgaW4gbm9kZSkge1xuXHRcdHNldFByb3BlcnR5KG5vZGUsIG5hbWUsIHZhbHVlPT1udWxsID8gJycgOiB2YWx1ZSk7XG5cdFx0aWYgKHZhbHVlPT1udWxsIHx8IHZhbHVlPT09ZmFsc2UpIG5vZGUucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuXHR9XG5cdGVsc2Uge1xuXHRcdGxldCBucyA9IGlzU3ZnICYmIG5hbWUubWF0Y2goL154bGlua1xcOj8oLispLyk7XG5cdFx0aWYgKHZhbHVlPT1udWxsIHx8IHZhbHVlPT09ZmFsc2UpIHtcblx0XHRcdGlmIChucykgbm9kZS5yZW1vdmVBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIHRvTG93ZXJDYXNlKG5zWzFdKSk7XG5cdFx0XHRlbHNlIG5vZGUucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuXHRcdH1cblx0XHRlbHNlIGlmICh0eXBlb2YgdmFsdWUhPT0nb2JqZWN0JyAmJiAhaXNGdW5jdGlvbih2YWx1ZSkpIHtcblx0XHRcdGlmIChucykgbm9kZS5zZXRBdHRyaWJ1dGVOUygnaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluaycsIHRvTG93ZXJDYXNlKG5zWzFdKSwgdmFsdWUpO1xuXHRcdFx0ZWxzZSBub2RlLnNldEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSk7XG5cdFx0fVxuXHR9XG59XG5cblxuLyoqIEF0dGVtcHQgdG8gc2V0IGEgRE9NIHByb3BlcnR5IHRvIHRoZSBnaXZlbiB2YWx1ZS5cbiAqXHRJRSAmIEZGIHRocm93IGZvciBjZXJ0YWluIHByb3BlcnR5LXZhbHVlIGNvbWJpbmF0aW9ucy5cbiAqL1xuZnVuY3Rpb24gc2V0UHJvcGVydHkobm9kZSwgbmFtZSwgdmFsdWUpIHtcblx0dHJ5IHtcblx0XHRub2RlW25hbWVdID0gdmFsdWU7XG5cdH0gY2F0Y2ggKGUpIHsgfVxufVxuXG5cbi8qKiBQcm94eSBhbiBldmVudCB0byBob29rZWQgZXZlbnQgaGFuZGxlcnNcbiAqXHRAcHJpdmF0ZVxuICovXG5mdW5jdGlvbiBldmVudFByb3h5KGUpIHtcblx0cmV0dXJuIHRoaXMuX2xpc3RlbmVyc1tlLnR5cGVdKG9wdGlvbnMuZXZlbnQgJiYgb3B0aW9ucy5ldmVudChlKSB8fCBlKTtcbn1cbiIsImltcG9ydCB7IHRvTG93ZXJDYXNlIH0gZnJvbSAnLi4vdXRpbCc7XG5pbXBvcnQgeyByZW1vdmVOb2RlIH0gZnJvbSAnLi9pbmRleCc7XG5cbi8qKiBET00gbm9kZSBwb29sLCBrZXllZCBvbiBub2RlTmFtZS4gKi9cblxuY29uc3Qgbm9kZXMgPSB7fTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3ROb2RlKG5vZGUpIHtcblx0cmVtb3ZlTm9kZShub2RlKTtcblxuXHRpZiAobm9kZSBpbnN0YW5jZW9mIEVsZW1lbnQpIHtcblx0XHRub2RlLl9jb21wb25lbnQgPSBub2RlLl9jb21wb25lbnRDb25zdHJ1Y3RvciA9IG51bGw7XG5cblx0XHRsZXQgbmFtZSA9IG5vZGUubm9ybWFsaXplZE5vZGVOYW1lIHx8IHRvTG93ZXJDYXNlKG5vZGUubm9kZU5hbWUpO1xuXHRcdChub2Rlc1tuYW1lXSB8fCAobm9kZXNbbmFtZV0gPSBbXSkpLnB1c2gobm9kZSk7XG5cdH1cbn1cblxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTm9kZShub2RlTmFtZSwgaXNTdmcpIHtcblx0bGV0IG5hbWUgPSB0b0xvd2VyQ2FzZShub2RlTmFtZSksXG5cdFx0bm9kZSA9IG5vZGVzW25hbWVdICYmIG5vZGVzW25hbWVdLnBvcCgpIHx8IChpc1N2ZyA/IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUygnaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnLCBub2RlTmFtZSkgOiBkb2N1bWVudC5jcmVhdGVFbGVtZW50KG5vZGVOYW1lKSk7XG5cdG5vZGUubm9ybWFsaXplZE5vZGVOYW1lID0gbmFtZTtcblx0cmV0dXJuIG5vZGU7XG59XG4iLCJpbXBvcnQgeyBBVFRSX0tFWSB9IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgeyBpc1N0cmluZywgaXNGdW5jdGlvbiB9IGZyb20gJy4uL3V0aWwnO1xuaW1wb3J0IHsgaXNTYW1lTm9kZVR5cGUsIGlzTmFtZWROb2RlIH0gZnJvbSAnLi9pbmRleCc7XG5pbXBvcnQgeyBpc0Z1bmN0aW9uYWxDb21wb25lbnQsIGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudCB9IGZyb20gJy4vZnVuY3Rpb25hbC1jb21wb25lbnQnO1xuaW1wb3J0IHsgYnVpbGRDb21wb25lbnRGcm9tVk5vZGUgfSBmcm9tICcuL2NvbXBvbmVudCc7XG5pbXBvcnQgeyBzZXRBY2Nlc3NvciwgcmVtb3ZlTm9kZSB9IGZyb20gJy4uL2RvbS9pbmRleCc7XG5pbXBvcnQgeyBjcmVhdGVOb2RlLCBjb2xsZWN0Tm9kZSB9IGZyb20gJy4uL2RvbS9yZWN5Y2xlcic7XG5pbXBvcnQgeyB1bm1vdW50Q29tcG9uZW50IH0gZnJvbSAnLi9jb21wb25lbnQnO1xuaW1wb3J0IG9wdGlvbnMgZnJvbSAnLi4vb3B0aW9ucyc7XG5cblxuLyoqIFF1ZXVlIG9mIGNvbXBvbmVudHMgdGhhdCBoYXZlIGJlZW4gbW91bnRlZCBhbmQgYXJlIGF3YWl0aW5nIGNvbXBvbmVudERpZE1vdW50ICovXG5leHBvcnQgY29uc3QgbW91bnRzID0gW107XG5cbi8qKiBEaWZmIHJlY3Vyc2lvbiBjb3VudCwgdXNlZCB0byB0cmFjayB0aGUgZW5kIG9mIHRoZSBkaWZmIGN5Y2xlLiAqL1xuZXhwb3J0IGxldCBkaWZmTGV2ZWwgPSAwO1xuXG4vKiogR2xvYmFsIGZsYWcgaW5kaWNhdGluZyBpZiB0aGUgZGlmZiBpcyBjdXJyZW50bHkgd2l0aGluIGFuIFNWRyAqL1xubGV0IGlzU3ZnTW9kZSA9IGZhbHNlO1xuXG4vKiogR2xvYmFsIGZsYWcgaW5kaWNhdGluZyBpZiB0aGUgZGlmZiBpcyBwZXJmb3JtaW5nIGh5ZHJhdGlvbiAqL1xubGV0IGh5ZHJhdGluZyA9IGZhbHNlO1xuXG5cbi8qKiBJbnZva2UgcXVldWVkIGNvbXBvbmVudERpZE1vdW50IGxpZmVjeWNsZSBtZXRob2RzICovXG5leHBvcnQgZnVuY3Rpb24gZmx1c2hNb3VudHMoKSB7XG5cdGxldCBjO1xuXHR3aGlsZSAoKGM9bW91bnRzLnBvcCgpKSkge1xuXHRcdGlmIChvcHRpb25zLmFmdGVyTW91bnQpIG9wdGlvbnMuYWZ0ZXJNb3VudChjKTtcblx0XHRpZiAoYy5jb21wb25lbnREaWRNb3VudCkgYy5jb21wb25lbnREaWRNb3VudCgpO1xuXHR9XG59XG5cblxuLyoqIEFwcGx5IGRpZmZlcmVuY2VzIGluIGEgZ2l2ZW4gdm5vZGUgKGFuZCBpdCdzIGRlZXAgY2hpbGRyZW4pIHRvIGEgcmVhbCBET00gTm9kZS5cbiAqXHRAcGFyYW0ge0VsZW1lbnR9IFtkb209bnVsbF1cdFx0QSBET00gbm9kZSB0byBtdXRhdGUgaW50byB0aGUgc2hhcGUgb2YgdGhlIGB2bm9kZWBcbiAqXHRAcGFyYW0ge1ZOb2RlfSB2bm9kZVx0XHRcdEEgVk5vZGUgKHdpdGggZGVzY2VuZGFudHMgZm9ybWluZyBhIHRyZWUpIHJlcHJlc2VudGluZyB0aGUgZGVzaXJlZCBET00gc3RydWN0dXJlXG4gKlx0QHJldHVybnMge0VsZW1lbnR9IGRvbVx0XHRcdFRoZSBjcmVhdGVkL211dGF0ZWQgZWxlbWVudFxuICpcdEBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaWZmKGRvbSwgdm5vZGUsIGNvbnRleHQsIG1vdW50QWxsLCBwYXJlbnQsIGNvbXBvbmVudFJvb3QpIHtcblx0Ly8gZGlmZkxldmVsIGhhdmluZyBiZWVuIDAgaGVyZSBpbmRpY2F0ZXMgaW5pdGlhbCBlbnRyeSBpbnRvIHRoZSBkaWZmIChub3QgYSBzdWJkaWZmKVxuXHRpZiAoIWRpZmZMZXZlbCsrKSB7XG5cdFx0Ly8gd2hlbiBmaXJzdCBzdGFydGluZyB0aGUgZGlmZiwgY2hlY2sgaWYgd2UncmUgZGlmZmluZyBhbiBTVkcgb3Igd2l0aGluIGFuIFNWR1xuXHRcdGlzU3ZnTW9kZSA9IHBhcmVudCBpbnN0YW5jZW9mIFNWR0VsZW1lbnQ7XG5cblx0XHQvLyBoeWRyYXRpb24gaXMgaW5pZGljYXRlZCBieSB0aGUgZXhpc3RpbmcgZWxlbWVudCB0byBiZSBkaWZmZWQgbm90IGhhdmluZyBhIHByb3AgY2FjaGVcblx0XHRoeWRyYXRpbmcgPSBkb20gJiYgIShBVFRSX0tFWSBpbiBkb20pO1xuXHR9XG5cblx0bGV0IHJldCA9IGlkaWZmKGRvbSwgdm5vZGUsIGNvbnRleHQsIG1vdW50QWxsKTtcblxuXHQvLyBhcHBlbmQgdGhlIGVsZW1lbnQgaWYgaXRzIGEgbmV3IHBhcmVudFxuXHRpZiAocGFyZW50ICYmIHJldC5wYXJlbnROb2RlIT09cGFyZW50KSBwYXJlbnQuYXBwZW5kQ2hpbGQocmV0KTtcblxuXHQvLyBkaWZmTGV2ZWwgYmVpbmcgcmVkdWNlZCB0byAwIG1lYW5zIHdlJ3JlIGV4aXRpbmcgdGhlIGRpZmZcblx0aWYgKCEtLWRpZmZMZXZlbCkge1xuXHRcdGh5ZHJhdGluZyA9IGZhbHNlO1xuXHRcdC8vIGludm9rZSBxdWV1ZWQgY29tcG9uZW50RGlkTW91bnQgbGlmZWN5Y2xlIG1ldGhvZHNcblx0XHRpZiAoIWNvbXBvbmVudFJvb3QpIGZsdXNoTW91bnRzKCk7XG5cdH1cblxuXHRyZXR1cm4gcmV0O1xufVxuXG5cbmZ1bmN0aW9uIGlkaWZmKGRvbSwgdm5vZGUsIGNvbnRleHQsIG1vdW50QWxsKSB7XG5cdGxldCBvcmlnaW5hbEF0dHJpYnV0ZXMgPSB2bm9kZSAmJiB2bm9kZS5hdHRyaWJ1dGVzO1xuXG5cblx0Ly8gUmVzb2x2ZSBlcGhlbWVyYWwgUHVyZSBGdW5jdGlvbmFsIENvbXBvbmVudHNcblx0d2hpbGUgKGlzRnVuY3Rpb25hbENvbXBvbmVudCh2bm9kZSkpIHtcblx0XHR2bm9kZSA9IGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudCh2bm9kZSwgY29udGV4dCk7XG5cdH1cblxuXG5cdC8vIGVtcHR5IHZhbHVlcyAobnVsbCAmIHVuZGVmaW5lZCkgcmVuZGVyIGFzIGVtcHR5IFRleHQgbm9kZXNcblx0aWYgKHZub2RlPT1udWxsKSB2bm9kZSA9ICcnO1xuXG5cblx0Ly8gRmFzdCBjYXNlOiBTdHJpbmdzIGNyZWF0ZS91cGRhdGUgVGV4dCBub2Rlcy5cblx0aWYgKGlzU3RyaW5nKHZub2RlKSkge1xuXHRcdC8vIHVwZGF0ZSBpZiBpdCdzIGFscmVhZHkgYSBUZXh0IG5vZGVcblx0XHRpZiAoZG9tICYmIGRvbSBpbnN0YW5jZW9mIFRleHQpIHtcblx0XHRcdGlmIChkb20ubm9kZVZhbHVlIT12bm9kZSkge1xuXHRcdFx0XHRkb20ubm9kZVZhbHVlID0gdm5vZGU7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGVsc2Uge1xuXHRcdFx0Ly8gaXQgd2Fzbid0IGEgVGV4dCBub2RlOiByZXBsYWNlIGl0IHdpdGggb25lIGFuZCByZWN5Y2xlIHRoZSBvbGQgRWxlbWVudFxuXHRcdFx0aWYgKGRvbSkgcmVjb2xsZWN0Tm9kZVRyZWUoZG9tKTtcblx0XHRcdGRvbSA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHZub2RlKTtcblx0XHR9XG5cblx0XHQvLyBNYXJrIGZvciBub24taHlkcmF0aW9uIHVwZGF0ZXNcblx0XHRkb21bQVRUUl9LRVldID0gdHJ1ZTtcblx0XHRyZXR1cm4gZG9tO1xuXHR9XG5cblxuXHQvLyBJZiB0aGUgVk5vZGUgcmVwcmVzZW50cyBhIENvbXBvbmVudCwgcGVyZm9ybSBhIGNvbXBvbmVudCBkaWZmLlxuXHRpZiAoaXNGdW5jdGlvbih2bm9kZS5ub2RlTmFtZSkpIHtcblx0XHRyZXR1cm4gYnVpbGRDb21wb25lbnRGcm9tVk5vZGUoZG9tLCB2bm9kZSwgY29udGV4dCwgbW91bnRBbGwpO1xuXHR9XG5cblxuXHRsZXQgb3V0ID0gZG9tLFxuXHRcdG5vZGVOYW1lID0gU3RyaW5nKHZub2RlLm5vZGVOYW1lKSxcdC8vIEBUT0RPIHRoaXMgbWFza3MgdW5kZWZpbmVkIGNvbXBvbmVudCBlcnJvcnMgYXMgYDx1bmRlZmluZWQ+YFxuXHRcdHByZXZTdmdNb2RlID0gaXNTdmdNb2RlLFxuXHRcdHZjaGlsZHJlbiA9IHZub2RlLmNoaWxkcmVuO1xuXG5cblx0Ly8gU1ZHcyBoYXZlIHNwZWNpYWwgbmFtZXNwYWNlIHN0dWZmLlxuXHQvLyBUaGlzIHRyYWNrcyBlbnRlcmluZyBhbmQgZXhpdGluZyB0aGF0IG5hbWVzcGFjZSB3aGVuIGRlc2NlbmRpbmcgdGhyb3VnaCB0aGUgdHJlZS5cblx0aXNTdmdNb2RlID0gbm9kZU5hbWU9PT0nc3ZnJyA/IHRydWUgOiBub2RlTmFtZT09PSdmb3JlaWduT2JqZWN0JyA/IGZhbHNlIDogaXNTdmdNb2RlO1xuXG5cblx0aWYgKCFkb20pIHtcblx0XHQvLyBjYXNlOiB3ZSBoYWQgbm8gZWxlbWVudCB0byBiZWdpbiB3aXRoXG5cdFx0Ly8gLSBjcmVhdGUgYW4gZWxlbWVudCB0byB3aXRoIHRoZSBub2RlTmFtZSBmcm9tIFZOb2RlXG5cdFx0b3V0ID0gY3JlYXRlTm9kZShub2RlTmFtZSwgaXNTdmdNb2RlKTtcblx0fVxuXHRlbHNlIGlmICghaXNOYW1lZE5vZGUoZG9tLCBub2RlTmFtZSkpIHtcblx0XHQvLyBjYXNlOiBFbGVtZW50IGFuZCBWTm9kZSBoYWQgZGlmZmVyZW50IG5vZGVOYW1lc1xuXHRcdC8vIC0gbmVlZCB0byBjcmVhdGUgdGhlIGNvcnJlY3QgRWxlbWVudCB0byBtYXRjaCBWTm9kZVxuXHRcdC8vIC0gdGhlbiBtaWdyYXRlIGNoaWxkcmVuIGZyb20gb2xkIHRvIG5ld1xuXG5cdFx0b3V0ID0gY3JlYXRlTm9kZShub2RlTmFtZSwgaXNTdmdNb2RlKTtcblxuXHRcdC8vIG1vdmUgY2hpbGRyZW4gaW50byB0aGUgcmVwbGFjZW1lbnQgbm9kZVxuXHRcdHdoaWxlIChkb20uZmlyc3RDaGlsZCkgb3V0LmFwcGVuZENoaWxkKGRvbS5maXJzdENoaWxkKTtcblxuXHRcdC8vIGlmIHRoZSBwcmV2aW91cyBFbGVtZW50IHdhcyBtb3VudGVkIGludG8gdGhlIERPTSwgcmVwbGFjZSBpdCBpbmxpbmVcblx0XHRpZiAoZG9tLnBhcmVudE5vZGUpIGRvbS5wYXJlbnROb2RlLnJlcGxhY2VDaGlsZChvdXQsIGRvbSk7XG5cblx0XHQvLyByZWN5Y2xlIHRoZSBvbGQgZWxlbWVudCAoc2tpcHMgbm9uLUVsZW1lbnQgbm9kZSB0eXBlcylcblx0XHRyZWNvbGxlY3ROb2RlVHJlZShkb20pO1xuXHR9XG5cblxuXHRsZXQgZmMgPSBvdXQuZmlyc3RDaGlsZCxcblx0XHRwcm9wcyA9IG91dFtBVFRSX0tFWV07XG5cblx0Ly8gQXR0cmlidXRlIEh5ZHJhdGlvbjogaWYgdGhlcmUgaXMgbm8gcHJvcCBjYWNoZSBvbiB0aGUgZWxlbWVudCxcblx0Ly8gLi4uY3JlYXRlIGl0IGFuZCBwb3B1bGF0ZSBpdCB3aXRoIHRoZSBlbGVtZW50J3MgYXR0cmlidXRlcy5cblx0aWYgKCFwcm9wcykge1xuXHRcdG91dFtBVFRSX0tFWV0gPSBwcm9wcyA9IHt9O1xuXHRcdGZvciAobGV0IGE9b3V0LmF0dHJpYnV0ZXMsIGk9YS5sZW5ndGg7IGktLTsgKSBwcm9wc1thW2ldLm5hbWVdID0gYVtpXS52YWx1ZTtcblx0fVxuXG5cdC8vIEFwcGx5IGF0dHJpYnV0ZXMvcHJvcHMgZnJvbSBWTm9kZSB0byB0aGUgRE9NIEVsZW1lbnQ6XG5cdGRpZmZBdHRyaWJ1dGVzKG91dCwgdm5vZGUuYXR0cmlidXRlcywgcHJvcHMpO1xuXG5cblx0Ly8gT3B0aW1pemF0aW9uOiBmYXN0LXBhdGggZm9yIGVsZW1lbnRzIGNvbnRhaW5pbmcgYSBzaW5nbGUgVGV4dE5vZGU6XG5cdGlmICghaHlkcmF0aW5nICYmIHZjaGlsZHJlbiAmJiB2Y2hpbGRyZW4ubGVuZ3RoPT09MSAmJiB0eXBlb2YgdmNoaWxkcmVuWzBdPT09J3N0cmluZycgJiYgZmMgJiYgZmMgaW5zdGFuY2VvZiBUZXh0ICYmICFmYy5uZXh0U2libGluZykge1xuXHRcdGlmIChmYy5ub2RlVmFsdWUhPXZjaGlsZHJlblswXSkge1xuXHRcdFx0ZmMubm9kZVZhbHVlID0gdmNoaWxkcmVuWzBdO1xuXHRcdH1cblx0fVxuXHQvLyBvdGhlcndpc2UsIGlmIHRoZXJlIGFyZSBleGlzdGluZyBvciBuZXcgY2hpbGRyZW4sIGRpZmYgdGhlbTpcblx0ZWxzZSBpZiAodmNoaWxkcmVuICYmIHZjaGlsZHJlbi5sZW5ndGggfHwgZmMpIHtcblx0XHRpbm5lckRpZmZOb2RlKG91dCwgdmNoaWxkcmVuLCBjb250ZXh0LCBtb3VudEFsbCk7XG5cdH1cblxuXG5cdC8vIGludm9rZSBvcmlnaW5hbCByZWYgKGZyb20gYmVmb3JlIHJlc29sdmluZyBQdXJlIEZ1bmN0aW9uYWwgQ29tcG9uZW50cyk6XG5cdGlmIChvcmlnaW5hbEF0dHJpYnV0ZXMgJiYgdHlwZW9mIG9yaWdpbmFsQXR0cmlidXRlcy5yZWY9PT0nZnVuY3Rpb24nKSB7XG5cdFx0KHByb3BzLnJlZiA9IG9yaWdpbmFsQXR0cmlidXRlcy5yZWYpKG91dCk7XG5cdH1cblxuXHRpc1N2Z01vZGUgPSBwcmV2U3ZnTW9kZTtcblxuXHRyZXR1cm4gb3V0O1xufVxuXG5cbi8qKiBBcHBseSBjaGlsZCBhbmQgYXR0cmlidXRlIGNoYW5nZXMgYmV0d2VlbiBhIFZOb2RlIGFuZCBhIERPTSBOb2RlIHRvIHRoZSBET00uXG4gKlx0QHBhcmFtIHtFbGVtZW50fSBkb21cdFx0RWxlbWVudCB3aG9zZSBjaGlsZHJlbiBzaG91bGQgYmUgY29tcGFyZWQgJiBtdXRhdGVkXG4gKlx0QHBhcmFtIHtBcnJheX0gdmNoaWxkcmVuXHRBcnJheSBvZiBWTm9kZXMgdG8gY29tcGFyZSB0byBgZG9tLmNoaWxkTm9kZXNgXG4gKlx0QHBhcmFtIHtPYmplY3R9IGNvbnRleHRcdFx0SW1wbGljaXRseSBkZXNjZW5kYW50IGNvbnRleHQgb2JqZWN0IChmcm9tIG1vc3QgcmVjZW50IGBnZXRDaGlsZENvbnRleHQoKWApXG4gKlx0QHBhcmFtIHtCb29sZWFufSBtb3V0QWxsXG4gKi9cbmZ1bmN0aW9uIGlubmVyRGlmZk5vZGUoZG9tLCB2Y2hpbGRyZW4sIGNvbnRleHQsIG1vdW50QWxsKSB7XG5cdGxldCBvcmlnaW5hbENoaWxkcmVuID0gZG9tLmNoaWxkTm9kZXMsXG5cdFx0Y2hpbGRyZW4gPSBbXSxcblx0XHRrZXllZCA9IHt9LFxuXHRcdGtleWVkTGVuID0gMCxcblx0XHRtaW4gPSAwLFxuXHRcdGxlbiA9IG9yaWdpbmFsQ2hpbGRyZW4ubGVuZ3RoLFxuXHRcdGNoaWxkcmVuTGVuID0gMCxcblx0XHR2bGVuID0gdmNoaWxkcmVuICYmIHZjaGlsZHJlbi5sZW5ndGgsXG5cdFx0aiwgYywgdmNoaWxkLCBjaGlsZDtcblxuXHRpZiAobGVuKSB7XG5cdFx0Zm9yIChsZXQgaT0wOyBpPGxlbjsgaSsrKSB7XG5cdFx0XHRsZXQgY2hpbGQgPSBvcmlnaW5hbENoaWxkcmVuW2ldLFxuXHRcdFx0XHRwcm9wcyA9IGNoaWxkW0FUVFJfS0VZXSxcblx0XHRcdFx0a2V5ID0gdmxlbiA/ICgoYyA9IGNoaWxkLl9jb21wb25lbnQpID8gYy5fX2tleSA6IHByb3BzID8gcHJvcHMua2V5IDogbnVsbCkgOiBudWxsO1xuXHRcdFx0aWYgKGtleSE9bnVsbCkge1xuXHRcdFx0XHRrZXllZExlbisrO1xuXHRcdFx0XHRrZXllZFtrZXldID0gY2hpbGQ7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIGlmIChoeWRyYXRpbmcgfHwgcHJvcHMpIHtcblx0XHRcdFx0Y2hpbGRyZW5bY2hpbGRyZW5MZW4rK10gPSBjaGlsZDtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHRpZiAodmxlbikge1xuXHRcdGZvciAobGV0IGk9MDsgaTx2bGVuOyBpKyspIHtcblx0XHRcdHZjaGlsZCA9IHZjaGlsZHJlbltpXTtcblx0XHRcdGNoaWxkID0gbnVsbDtcblxuXHRcdFx0Ly8gaWYgKGlzRnVuY3Rpb25hbENvbXBvbmVudCh2Y2hpbGQpKSB7XG5cdFx0XHQvLyBcdHZjaGlsZCA9IGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudCh2Y2hpbGQpO1xuXHRcdFx0Ly8gfVxuXG5cdFx0XHQvLyBhdHRlbXB0IHRvIGZpbmQgYSBub2RlIGJhc2VkIG9uIGtleSBtYXRjaGluZ1xuXHRcdFx0bGV0IGtleSA9IHZjaGlsZC5rZXk7XG5cdFx0XHRpZiAoa2V5IT1udWxsKSB7XG5cdFx0XHRcdGlmIChrZXllZExlbiAmJiBrZXkgaW4ga2V5ZWQpIHtcblx0XHRcdFx0XHRjaGlsZCA9IGtleWVkW2tleV07XG5cdFx0XHRcdFx0a2V5ZWRba2V5XSA9IHVuZGVmaW5lZDtcblx0XHRcdFx0XHRrZXllZExlbi0tO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHQvLyBhdHRlbXB0IHRvIHBsdWNrIGEgbm9kZSBvZiB0aGUgc2FtZSB0eXBlIGZyb20gdGhlIGV4aXN0aW5nIGNoaWxkcmVuXG5cdFx0XHRlbHNlIGlmICghY2hpbGQgJiYgbWluPGNoaWxkcmVuTGVuKSB7XG5cdFx0XHRcdGZvciAoaj1taW47IGo8Y2hpbGRyZW5MZW47IGorKykge1xuXHRcdFx0XHRcdGMgPSBjaGlsZHJlbltqXTtcblx0XHRcdFx0XHRpZiAoYyAmJiBpc1NhbWVOb2RlVHlwZShjLCB2Y2hpbGQpKSB7XG5cdFx0XHRcdFx0XHRjaGlsZCA9IGM7XG5cdFx0XHRcdFx0XHRjaGlsZHJlbltqXSA9IHVuZGVmaW5lZDtcblx0XHRcdFx0XHRcdGlmIChqPT09Y2hpbGRyZW5MZW4tMSkgY2hpbGRyZW5MZW4tLTtcblx0XHRcdFx0XHRcdGlmIChqPT09bWluKSBtaW4rKztcblx0XHRcdFx0XHRcdGJyZWFrO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHQvLyBtb3JwaCB0aGUgbWF0Y2hlZC9mb3VuZC9jcmVhdGVkIERPTSBjaGlsZCB0byBtYXRjaCB2Y2hpbGQgKGRlZXApXG5cdFx0XHRjaGlsZCA9IGlkaWZmKGNoaWxkLCB2Y2hpbGQsIGNvbnRleHQsIG1vdW50QWxsKTtcblxuXHRcdFx0aWYgKGNoaWxkICYmIGNoaWxkIT09ZG9tKSB7XG5cdFx0XHRcdGlmIChpPj1sZW4pIHtcblx0XHRcdFx0XHRkb20uYXBwZW5kQ2hpbGQoY2hpbGQpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2UgaWYgKGNoaWxkIT09b3JpZ2luYWxDaGlsZHJlbltpXSkge1xuXHRcdFx0XHRcdGlmIChjaGlsZD09PW9yaWdpbmFsQ2hpbGRyZW5baSsxXSkge1xuXHRcdFx0XHRcdFx0cmVtb3ZlTm9kZShvcmlnaW5hbENoaWxkcmVuW2ldKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0ZG9tLmluc2VydEJlZm9yZShjaGlsZCwgb3JpZ2luYWxDaGlsZHJlbltpXSB8fCBudWxsKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cblx0aWYgKGtleWVkTGVuKSB7XG5cdFx0Zm9yIChsZXQgaSBpbiBrZXllZCkgaWYgKGtleWVkW2ldKSByZWNvbGxlY3ROb2RlVHJlZShrZXllZFtpXSk7XG5cdH1cblxuXHQvLyByZW1vdmUgb3JwaGFuZWQgY2hpbGRyZW5cblx0d2hpbGUgKG1pbjw9Y2hpbGRyZW5MZW4pIHtcblx0XHRjaGlsZCA9IGNoaWxkcmVuW2NoaWxkcmVuTGVuLS1dO1xuXHRcdGlmIChjaGlsZCkgcmVjb2xsZWN0Tm9kZVRyZWUoY2hpbGQpO1xuXHR9XG59XG5cblxuXG4vKiogUmVjdXJzaXZlbHkgcmVjeWNsZSAob3IganVzdCB1bm1vdW50KSBhIG5vZGUgYW4gaXRzIGRlc2NlbmRhbnRzLlxuICpcdEBwYXJhbSB7Tm9kZX0gbm9kZVx0XHRcdFx0XHRcdERPTSBub2RlIHRvIHN0YXJ0IHVubW91bnQvcmVtb3ZhbCBmcm9tXG4gKlx0QHBhcmFtIHtCb29sZWFufSBbdW5tb3VudE9ubHk9ZmFsc2VdXHRJZiBgdHJ1ZWAsIG9ubHkgdHJpZ2dlcnMgdW5tb3VudCBsaWZlY3ljbGUsIHNraXBzIHJlbW92YWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY29sbGVjdE5vZGVUcmVlKG5vZGUsIHVubW91bnRPbmx5KSB7XG5cdGxldCBjb21wb25lbnQgPSBub2RlLl9jb21wb25lbnQ7XG5cdGlmIChjb21wb25lbnQpIHtcblx0XHQvLyBpZiBub2RlIGlzIG93bmVkIGJ5IGEgQ29tcG9uZW50LCB1bm1vdW50IHRoYXQgY29tcG9uZW50IChlbmRzIHVwIHJlY3Vyc2luZyBiYWNrIGhlcmUpXG5cdFx0dW5tb3VudENvbXBvbmVudChjb21wb25lbnQsICF1bm1vdW50T25seSk7XG5cdH1cblx0ZWxzZSB7XG5cdFx0Ly8gSWYgdGhlIG5vZGUncyBWTm9kZSBoYWQgYSByZWYgZnVuY3Rpb24sIGludm9rZSBpdCB3aXRoIG51bGwgaGVyZS5cblx0XHQvLyAodGhpcyBpcyBwYXJ0IG9mIHRoZSBSZWFjdCBzcGVjLCBhbmQgc21hcnQgZm9yIHVuc2V0dGluZyByZWZlcmVuY2VzKVxuXHRcdGlmIChub2RlW0FUVFJfS0VZXSAmJiBub2RlW0FUVFJfS0VZXS5yZWYpIG5vZGVbQVRUUl9LRVldLnJlZihudWxsKTtcblxuXHRcdGlmICghdW5tb3VudE9ubHkpIHtcblx0XHRcdGNvbGxlY3ROb2RlKG5vZGUpO1xuXHRcdH1cblxuXHRcdC8vIFJlY29sbGVjdC91bm1vdW50IGFsbCBjaGlsZHJlbi5cblx0XHQvLyAtIHdlIHVzZSAubGFzdENoaWxkIGhlcmUgYmVjYXVzZSBpdCBjYXVzZXMgbGVzcyByZWZsb3cgdGhhbiAuZmlyc3RDaGlsZFxuXHRcdC8vIC0gaXQncyBhbHNvIGNoZWFwZXIgdGhhbiBhY2Nlc3NpbmcgdGhlIC5jaGlsZE5vZGVzIExpdmUgTm9kZUxpc3Rcblx0XHRsZXQgYztcblx0XHR3aGlsZSAoKGM9bm9kZS5sYXN0Q2hpbGQpKSByZWNvbGxlY3ROb2RlVHJlZShjLCB1bm1vdW50T25seSk7XG5cdH1cbn1cblxuXG5cbi8qKiBBcHBseSBkaWZmZXJlbmNlcyBpbiBhdHRyaWJ1dGVzIGZyb20gYSBWTm9kZSB0byB0aGUgZ2l2ZW4gRE9NIEVsZW1lbnQuXG4gKlx0QHBhcmFtIHtFbGVtZW50fSBkb21cdFx0RWxlbWVudCB3aXRoIGF0dHJpYnV0ZXMgdG8gZGlmZiBgYXR0cnNgIGFnYWluc3RcbiAqXHRAcGFyYW0ge09iamVjdH0gYXR0cnNcdFx0VGhlIGRlc2lyZWQgZW5kLXN0YXRlIGtleS12YWx1ZSBhdHRyaWJ1dGUgcGFpcnNcbiAqXHRAcGFyYW0ge09iamVjdH0gb2xkXHRcdFx0Q3VycmVudC9wcmV2aW91cyBhdHRyaWJ1dGVzIChmcm9tIHByZXZpb3VzIFZOb2RlIG9yIGVsZW1lbnQncyBwcm9wIGNhY2hlKVxuICovXG5mdW5jdGlvbiBkaWZmQXR0cmlidXRlcyhkb20sIGF0dHJzLCBvbGQpIHtcblx0Ly8gcmVtb3ZlIGF0dHJpYnV0ZXMgbm8gbG9uZ2VyIHByZXNlbnQgb24gdGhlIHZub2RlIGJ5IHNldHRpbmcgdGhlbSB0byB1bmRlZmluZWRcblx0Zm9yIChsZXQgbmFtZSBpbiBvbGQpIHtcblx0XHRpZiAoIShhdHRycyAmJiBuYW1lIGluIGF0dHJzKSAmJiBvbGRbbmFtZV0hPW51bGwpIHtcblx0XHRcdHNldEFjY2Vzc29yKGRvbSwgbmFtZSwgb2xkW25hbWVdLCBvbGRbbmFtZV0gPSB1bmRlZmluZWQsIGlzU3ZnTW9kZSk7XG5cdFx0fVxuXHR9XG5cblx0Ly8gYWRkIG5ldyAmIHVwZGF0ZSBjaGFuZ2VkIGF0dHJpYnV0ZXNcblx0aWYgKGF0dHJzKSB7XG5cdFx0Zm9yIChsZXQgbmFtZSBpbiBhdHRycykge1xuXHRcdFx0aWYgKG5hbWUhPT0nY2hpbGRyZW4nICYmIG5hbWUhPT0naW5uZXJIVE1MJyAmJiAoIShuYW1lIGluIG9sZCkgfHwgYXR0cnNbbmFtZV0hPT0obmFtZT09PSd2YWx1ZScgfHwgbmFtZT09PSdjaGVja2VkJyA/IGRvbVtuYW1lXSA6IG9sZFtuYW1lXSkpKSB7XG5cdFx0XHRcdHNldEFjY2Vzc29yKGRvbSwgbmFtZSwgb2xkW25hbWVdLCBvbGRbbmFtZV0gPSBhdHRyc1tuYW1lXSwgaXNTdmdNb2RlKTtcblx0XHRcdH1cblx0XHR9XG5cdH1cbn1cbiIsImltcG9ydCB7IENvbXBvbmVudCB9IGZyb20gJy4uL2NvbXBvbmVudCc7XG5cbi8qKiBSZXRhaW5zIGEgcG9vbCBvZiBDb21wb25lbnRzIGZvciByZS11c2UsIGtleWVkIG9uIGNvbXBvbmVudCBuYW1lLlxuICpcdE5vdGU6IHNpbmNlIGNvbXBvbmVudCBuYW1lcyBhcmUgbm90IHVuaXF1ZSBvciBldmVuIG5lY2Vzc2FyaWx5IGF2YWlsYWJsZSwgdGhlc2UgYXJlIHByaW1hcmlseSBhIGZvcm0gb2Ygc2hhcmRpbmcuXG4gKlx0QHByaXZhdGVcbiAqL1xuY29uc3QgY29tcG9uZW50cyA9IHt9O1xuXG5cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0Q29tcG9uZW50KGNvbXBvbmVudCkge1xuXHRsZXQgbmFtZSA9IGNvbXBvbmVudC5jb25zdHJ1Y3Rvci5uYW1lLFxuXHRcdGxpc3QgPSBjb21wb25lbnRzW25hbWVdO1xuXHRpZiAobGlzdCkgbGlzdC5wdXNoKGNvbXBvbmVudCk7XG5cdGVsc2UgY29tcG9uZW50c1tuYW1lXSA9IFtjb21wb25lbnRdO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDb21wb25lbnQoQ3RvciwgcHJvcHMsIGNvbnRleHQpIHtcblx0bGV0IGluc3QgPSBuZXcgQ3Rvcihwcm9wcywgY29udGV4dCksXG5cdFx0bGlzdCA9IGNvbXBvbmVudHNbQ3Rvci5uYW1lXTtcblx0Q29tcG9uZW50LmNhbGwoaW5zdCwgcHJvcHMsIGNvbnRleHQpO1xuXHRpZiAobGlzdCkge1xuXHRcdGZvciAobGV0IGk9bGlzdC5sZW5ndGg7IGktLTsgKSB7XG5cdFx0XHRpZiAobGlzdFtpXS5jb25zdHJ1Y3Rvcj09PUN0b3IpIHtcblx0XHRcdFx0aW5zdC5uZXh0QmFzZSA9IGxpc3RbaV0ubmV4dEJhc2U7XG5cdFx0XHRcdGxpc3Quc3BsaWNlKGksIDEpO1xuXHRcdFx0XHRicmVhaztcblx0XHRcdH1cblx0XHR9XG5cdH1cblx0cmV0dXJuIGluc3Q7XG59XG4iLCJpbXBvcnQgeyBTWU5DX1JFTkRFUiwgTk9fUkVOREVSLCBGT1JDRV9SRU5ERVIsIEFTWU5DX1JFTkRFUiwgQVRUUl9LRVkgfSBmcm9tICcuLi9jb25zdGFudHMnO1xuaW1wb3J0IG9wdGlvbnMgZnJvbSAnLi4vb3B0aW9ucyc7XG5pbXBvcnQgeyBpc0Z1bmN0aW9uLCBjbG9uZSwgZXh0ZW5kIH0gZnJvbSAnLi4vdXRpbCc7XG5pbXBvcnQgeyBlbnF1ZXVlUmVuZGVyIH0gZnJvbSAnLi4vcmVuZGVyLXF1ZXVlJztcbmltcG9ydCB7IGdldE5vZGVQcm9wcyB9IGZyb20gJy4vaW5kZXgnO1xuaW1wb3J0IHsgZGlmZiwgbW91bnRzLCBkaWZmTGV2ZWwsIGZsdXNoTW91bnRzLCByZWNvbGxlY3ROb2RlVHJlZSB9IGZyb20gJy4vZGlmZic7XG5pbXBvcnQgeyBpc0Z1bmN0aW9uYWxDb21wb25lbnQsIGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudCB9IGZyb20gJy4vZnVuY3Rpb25hbC1jb21wb25lbnQnO1xuaW1wb3J0IHsgY3JlYXRlQ29tcG9uZW50LCBjb2xsZWN0Q29tcG9uZW50IH0gZnJvbSAnLi9jb21wb25lbnQtcmVjeWNsZXInO1xuaW1wb3J0IHsgcmVtb3ZlTm9kZSB9IGZyb20gJy4uL2RvbS9pbmRleCc7XG5cblxuXG4vKiogU2V0IGEgY29tcG9uZW50J3MgYHByb3BzYCAoZ2VuZXJhbGx5IGRlcml2ZWQgZnJvbSBKU1ggYXR0cmlidXRlcykuXG4gKlx0QHBhcmFtIHtPYmplY3R9IHByb3BzXG4gKlx0QHBhcmFtIHtPYmplY3R9IFtvcHRzXVxuICpcdEBwYXJhbSB7Ym9vbGVhbn0gW29wdHMucmVuZGVyU3luYz1mYWxzZV1cdElmIGB0cnVlYCBhbmQge0BsaW5rIG9wdGlvbnMuc3luY0NvbXBvbmVudFVwZGF0ZXN9IGlzIGB0cnVlYCwgdHJpZ2dlcnMgc3luY2hyb25vdXMgcmVuZGVyaW5nLlxuICpcdEBwYXJhbSB7Ym9vbGVhbn0gW29wdHMucmVuZGVyPXRydWVdXHRcdFx0SWYgYGZhbHNlYCwgbm8gcmVuZGVyIHdpbGwgYmUgdHJpZ2dlcmVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0Q29tcG9uZW50UHJvcHMoY29tcG9uZW50LCBwcm9wcywgb3B0cywgY29udGV4dCwgbW91bnRBbGwpIHtcblx0aWYgKGNvbXBvbmVudC5fZGlzYWJsZSkgcmV0dXJuO1xuXHRjb21wb25lbnQuX2Rpc2FibGUgPSB0cnVlO1xuXG5cdGlmICgoY29tcG9uZW50Ll9fcmVmID0gcHJvcHMucmVmKSkgZGVsZXRlIHByb3BzLnJlZjtcblx0aWYgKChjb21wb25lbnQuX19rZXkgPSBwcm9wcy5rZXkpKSBkZWxldGUgcHJvcHMua2V5O1xuXG5cdGlmICghY29tcG9uZW50LmJhc2UgfHwgbW91bnRBbGwpIHtcblx0XHRpZiAoY29tcG9uZW50LmNvbXBvbmVudFdpbGxNb3VudCkgY29tcG9uZW50LmNvbXBvbmVudFdpbGxNb3VudCgpO1xuXHR9XG5cdGVsc2UgaWYgKGNvbXBvbmVudC5jb21wb25lbnRXaWxsUmVjZWl2ZVByb3BzKSB7XG5cdFx0Y29tcG9uZW50LmNvbXBvbmVudFdpbGxSZWNlaXZlUHJvcHMocHJvcHMsIGNvbnRleHQpO1xuXHR9XG5cblx0aWYgKGNvbnRleHQgJiYgY29udGV4dCE9PWNvbXBvbmVudC5jb250ZXh0KSB7XG5cdFx0aWYgKCFjb21wb25lbnQucHJldkNvbnRleHQpIGNvbXBvbmVudC5wcmV2Q29udGV4dCA9IGNvbXBvbmVudC5jb250ZXh0O1xuXHRcdGNvbXBvbmVudC5jb250ZXh0ID0gY29udGV4dDtcblx0fVxuXG5cdGlmICghY29tcG9uZW50LnByZXZQcm9wcykgY29tcG9uZW50LnByZXZQcm9wcyA9IGNvbXBvbmVudC5wcm9wcztcblx0Y29tcG9uZW50LnByb3BzID0gcHJvcHM7XG5cblx0Y29tcG9uZW50Ll9kaXNhYmxlID0gZmFsc2U7XG5cblx0aWYgKG9wdHMhPT1OT19SRU5ERVIpIHtcblx0XHRpZiAob3B0cz09PVNZTkNfUkVOREVSIHx8IG9wdGlvbnMuc3luY0NvbXBvbmVudFVwZGF0ZXMhPT1mYWxzZSB8fCAhY29tcG9uZW50LmJhc2UpIHtcblx0XHRcdHJlbmRlckNvbXBvbmVudChjb21wb25lbnQsIFNZTkNfUkVOREVSLCBtb3VudEFsbCk7XG5cdFx0fVxuXHRcdGVsc2Uge1xuXHRcdFx0ZW5xdWV1ZVJlbmRlcihjb21wb25lbnQpO1xuXHRcdH1cblx0fVxuXG5cdGlmIChjb21wb25lbnQuX19yZWYpIGNvbXBvbmVudC5fX3JlZihjb21wb25lbnQpO1xufVxuXG5cblxuLyoqIFJlbmRlciBhIENvbXBvbmVudCwgdHJpZ2dlcmluZyBuZWNlc3NhcnkgbGlmZWN5Y2xlIGV2ZW50cyBhbmQgdGFraW5nIEhpZ2gtT3JkZXIgQ29tcG9uZW50cyBpbnRvIGFjY291bnQuXG4gKlx0QHBhcmFtIHtDb21wb25lbnR9IGNvbXBvbmVudFxuICpcdEBwYXJhbSB7T2JqZWN0fSBbb3B0c11cbiAqXHRAcGFyYW0ge2Jvb2xlYW59IFtvcHRzLmJ1aWxkPWZhbHNlXVx0XHRJZiBgdHJ1ZWAsIGNvbXBvbmVudCB3aWxsIGJ1aWxkIGFuZCBzdG9yZSBhIERPTSBub2RlIGlmIG5vdCBhbHJlYWR5IGFzc29jaWF0ZWQgd2l0aCBvbmUuXG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckNvbXBvbmVudChjb21wb25lbnQsIG9wdHMsIG1vdW50QWxsLCBpc0NoaWxkKSB7XG5cdGlmIChjb21wb25lbnQuX2Rpc2FibGUpIHJldHVybjtcblxuXHRsZXQgc2tpcCwgcmVuZGVyZWQsXG5cdFx0cHJvcHMgPSBjb21wb25lbnQucHJvcHMsXG5cdFx0c3RhdGUgPSBjb21wb25lbnQuc3RhdGUsXG5cdFx0Y29udGV4dCA9IGNvbXBvbmVudC5jb250ZXh0LFxuXHRcdHByZXZpb3VzUHJvcHMgPSBjb21wb25lbnQucHJldlByb3BzIHx8IHByb3BzLFxuXHRcdHByZXZpb3VzU3RhdGUgPSBjb21wb25lbnQucHJldlN0YXRlIHx8IHN0YXRlLFxuXHRcdHByZXZpb3VzQ29udGV4dCA9IGNvbXBvbmVudC5wcmV2Q29udGV4dCB8fCBjb250ZXh0LFxuXHRcdGlzVXBkYXRlID0gY29tcG9uZW50LmJhc2UsXG5cdFx0bmV4dEJhc2UgPSBjb21wb25lbnQubmV4dEJhc2UsXG5cdFx0aW5pdGlhbEJhc2UgPSBpc1VwZGF0ZSB8fCBuZXh0QmFzZSxcblx0XHRpbml0aWFsQ2hpbGRDb21wb25lbnQgPSBjb21wb25lbnQuX2NvbXBvbmVudCxcblx0XHRpbnN0LCBjYmFzZTtcblxuXHQvLyBpZiB1cGRhdGluZ1xuXHRpZiAoaXNVcGRhdGUpIHtcblx0XHRjb21wb25lbnQucHJvcHMgPSBwcmV2aW91c1Byb3BzO1xuXHRcdGNvbXBvbmVudC5zdGF0ZSA9IHByZXZpb3VzU3RhdGU7XG5cdFx0Y29tcG9uZW50LmNvbnRleHQgPSBwcmV2aW91c0NvbnRleHQ7XG5cdFx0aWYgKG9wdHMhPT1GT1JDRV9SRU5ERVJcblx0XHRcdCYmIGNvbXBvbmVudC5zaG91bGRDb21wb25lbnRVcGRhdGVcblx0XHRcdCYmIGNvbXBvbmVudC5zaG91bGRDb21wb25lbnRVcGRhdGUocHJvcHMsIHN0YXRlLCBjb250ZXh0KSA9PT0gZmFsc2UpIHtcblx0XHRcdHNraXAgPSB0cnVlO1xuXHRcdH1cblx0XHRlbHNlIGlmIChjb21wb25lbnQuY29tcG9uZW50V2lsbFVwZGF0ZSkge1xuXHRcdFx0Y29tcG9uZW50LmNvbXBvbmVudFdpbGxVcGRhdGUocHJvcHMsIHN0YXRlLCBjb250ZXh0KTtcblx0XHR9XG5cdFx0Y29tcG9uZW50LnByb3BzID0gcHJvcHM7XG5cdFx0Y29tcG9uZW50LnN0YXRlID0gc3RhdGU7XG5cdFx0Y29tcG9uZW50LmNvbnRleHQgPSBjb250ZXh0O1xuXHR9XG5cblx0Y29tcG9uZW50LnByZXZQcm9wcyA9IGNvbXBvbmVudC5wcmV2U3RhdGUgPSBjb21wb25lbnQucHJldkNvbnRleHQgPSBjb21wb25lbnQubmV4dEJhc2UgPSBudWxsO1xuXHRjb21wb25lbnQuX2RpcnR5ID0gZmFsc2U7XG5cblx0aWYgKCFza2lwKSB7XG5cdFx0aWYgKGNvbXBvbmVudC5yZW5kZXIpIHJlbmRlcmVkID0gY29tcG9uZW50LnJlbmRlcihwcm9wcywgc3RhdGUsIGNvbnRleHQpO1xuXG5cdFx0Ly8gY29udGV4dCB0byBwYXNzIHRvIHRoZSBjaGlsZCwgY2FuIGJlIHVwZGF0ZWQgdmlhIChncmFuZC0pcGFyZW50IGNvbXBvbmVudFxuXHRcdGlmIChjb21wb25lbnQuZ2V0Q2hpbGRDb250ZXh0KSB7XG5cdFx0XHRjb250ZXh0ID0gZXh0ZW5kKGNsb25lKGNvbnRleHQpLCBjb21wb25lbnQuZ2V0Q2hpbGRDb250ZXh0KCkpO1xuXHRcdH1cblxuXHRcdHdoaWxlIChpc0Z1bmN0aW9uYWxDb21wb25lbnQocmVuZGVyZWQpKSB7XG5cdFx0XHRyZW5kZXJlZCA9IGJ1aWxkRnVuY3Rpb25hbENvbXBvbmVudChyZW5kZXJlZCwgY29udGV4dCk7XG5cdFx0fVxuXG5cdFx0bGV0IGNoaWxkQ29tcG9uZW50ID0gcmVuZGVyZWQgJiYgcmVuZGVyZWQubm9kZU5hbWUsXG5cdFx0XHR0b1VubW91bnQsIGJhc2U7XG5cblx0XHRpZiAoaXNGdW5jdGlvbihjaGlsZENvbXBvbmVudCkpIHtcblx0XHRcdC8vIHNldCB1cCBoaWdoIG9yZGVyIGNvbXBvbmVudCBsaW5rXG5cblx0XHRcdGxldCBjaGlsZFByb3BzID0gZ2V0Tm9kZVByb3BzKHJlbmRlcmVkKTtcblx0XHRcdGluc3QgPSBpbml0aWFsQ2hpbGRDb21wb25lbnQ7XG5cblx0XHRcdGlmIChpbnN0ICYmIGluc3QuY29uc3RydWN0b3I9PT1jaGlsZENvbXBvbmVudCAmJiBjaGlsZFByb3BzLmtleT09aW5zdC5fX2tleSkge1xuXHRcdFx0XHRzZXRDb21wb25lbnRQcm9wcyhpbnN0LCBjaGlsZFByb3BzLCBTWU5DX1JFTkRFUiwgY29udGV4dCk7XG5cdFx0XHR9XG5cdFx0XHRlbHNlIHtcblx0XHRcdFx0dG9Vbm1vdW50ID0gaW5zdDtcblxuXHRcdFx0XHRpbnN0ID0gY3JlYXRlQ29tcG9uZW50KGNoaWxkQ29tcG9uZW50LCBjaGlsZFByb3BzLCBjb250ZXh0KTtcblx0XHRcdFx0aW5zdC5uZXh0QmFzZSA9IGluc3QubmV4dEJhc2UgfHwgbmV4dEJhc2U7XG5cdFx0XHRcdGluc3QuX3BhcmVudENvbXBvbmVudCA9IGNvbXBvbmVudDtcblx0XHRcdFx0Y29tcG9uZW50Ll9jb21wb25lbnQgPSBpbnN0O1xuXHRcdFx0XHRzZXRDb21wb25lbnRQcm9wcyhpbnN0LCBjaGlsZFByb3BzLCBOT19SRU5ERVIsIGNvbnRleHQpO1xuXHRcdFx0XHRyZW5kZXJDb21wb25lbnQoaW5zdCwgU1lOQ19SRU5ERVIsIG1vdW50QWxsLCB0cnVlKTtcblx0XHRcdH1cblxuXHRcdFx0YmFzZSA9IGluc3QuYmFzZTtcblx0XHR9XG5cdFx0ZWxzZSB7XG5cdFx0XHRjYmFzZSA9IGluaXRpYWxCYXNlO1xuXG5cdFx0XHQvLyBkZXN0cm95IGhpZ2ggb3JkZXIgY29tcG9uZW50IGxpbmtcblx0XHRcdHRvVW5tb3VudCA9IGluaXRpYWxDaGlsZENvbXBvbmVudDtcblx0XHRcdGlmICh0b1VubW91bnQpIHtcblx0XHRcdFx0Y2Jhc2UgPSBjb21wb25lbnQuX2NvbXBvbmVudCA9IG51bGw7XG5cdFx0XHR9XG5cblx0XHRcdGlmIChpbml0aWFsQmFzZSB8fCBvcHRzPT09U1lOQ19SRU5ERVIpIHtcblx0XHRcdFx0aWYgKGNiYXNlKSBjYmFzZS5fY29tcG9uZW50ID0gbnVsbDtcblx0XHRcdFx0YmFzZSA9IGRpZmYoY2Jhc2UsIHJlbmRlcmVkLCBjb250ZXh0LCBtb3VudEFsbCB8fCAhaXNVcGRhdGUsIGluaXRpYWxCYXNlICYmIGluaXRpYWxCYXNlLnBhcmVudE5vZGUsIHRydWUpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGlmIChpbml0aWFsQmFzZSAmJiBiYXNlIT09aW5pdGlhbEJhc2UgJiYgaW5zdCE9PWluaXRpYWxDaGlsZENvbXBvbmVudCkge1xuXHRcdFx0bGV0IGJhc2VQYXJlbnQgPSBpbml0aWFsQmFzZS5wYXJlbnROb2RlO1xuXHRcdFx0aWYgKGJhc2VQYXJlbnQgJiYgYmFzZSE9PWJhc2VQYXJlbnQpIHtcblx0XHRcdFx0YmFzZVBhcmVudC5yZXBsYWNlQ2hpbGQoYmFzZSwgaW5pdGlhbEJhc2UpO1xuXG5cdFx0XHRcdGlmICghdG9Vbm1vdW50KSB7XG5cdFx0XHRcdFx0aW5pdGlhbEJhc2UuX2NvbXBvbmVudCA9IG51bGw7XG5cdFx0XHRcdFx0cmVjb2xsZWN0Tm9kZVRyZWUoaW5pdGlhbEJhc2UpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0aWYgKHRvVW5tb3VudCkge1xuXHRcdFx0dW5tb3VudENvbXBvbmVudCh0b1VubW91bnQsIGJhc2UhPT1pbml0aWFsQmFzZSk7XG5cdFx0fVxuXG5cdFx0Y29tcG9uZW50LmJhc2UgPSBiYXNlO1xuXHRcdGlmIChiYXNlICYmICFpc0NoaWxkKSB7XG5cdFx0XHRsZXQgY29tcG9uZW50UmVmID0gY29tcG9uZW50LFxuXHRcdFx0XHR0ID0gY29tcG9uZW50O1xuXHRcdFx0d2hpbGUgKCh0PXQuX3BhcmVudENvbXBvbmVudCkpIHtcblx0XHRcdFx0KGNvbXBvbmVudFJlZiA9IHQpLmJhc2UgPSBiYXNlO1xuXHRcdFx0fVxuXHRcdFx0YmFzZS5fY29tcG9uZW50ID0gY29tcG9uZW50UmVmO1xuXHRcdFx0YmFzZS5fY29tcG9uZW50Q29uc3RydWN0b3IgPSBjb21wb25lbnRSZWYuY29uc3RydWN0b3I7XG5cdFx0fVxuXHR9XG5cblx0aWYgKCFpc1VwZGF0ZSB8fCBtb3VudEFsbCkge1xuXHRcdG1vdW50cy51bnNoaWZ0KGNvbXBvbmVudCk7XG5cdH1cblx0ZWxzZSBpZiAoIXNraXApIHtcblx0XHRpZiAoY29tcG9uZW50LmNvbXBvbmVudERpZFVwZGF0ZSkge1xuXHRcdFx0Y29tcG9uZW50LmNvbXBvbmVudERpZFVwZGF0ZShwcmV2aW91c1Byb3BzLCBwcmV2aW91c1N0YXRlLCBwcmV2aW91c0NvbnRleHQpO1xuXHRcdH1cblx0XHRpZiAob3B0aW9ucy5hZnRlclVwZGF0ZSkgb3B0aW9ucy5hZnRlclVwZGF0ZShjb21wb25lbnQpO1xuXHR9XG5cblx0bGV0IGNiID0gY29tcG9uZW50Ll9yZW5kZXJDYWxsYmFja3MsIGZuO1xuXHRpZiAoY2IpIHdoaWxlICggKGZuID0gY2IucG9wKCkpICkgZm4uY2FsbChjb21wb25lbnQpO1xuXG5cdGlmICghZGlmZkxldmVsICYmICFpc0NoaWxkKSBmbHVzaE1vdW50cygpO1xufVxuXG5cblxuLyoqIEFwcGx5IHRoZSBDb21wb25lbnQgcmVmZXJlbmNlZCBieSBhIFZOb2RlIHRvIHRoZSBET00uXG4gKlx0QHBhcmFtIHtFbGVtZW50fSBkb21cdFRoZSBET00gbm9kZSB0byBtdXRhdGVcbiAqXHRAcGFyYW0ge1ZOb2RlfSB2bm9kZVx0QSBDb21wb25lbnQtcmVmZXJlbmNpbmcgVk5vZGVcbiAqXHRAcmV0dXJucyB7RWxlbWVudH0gZG9tXHRUaGUgY3JlYXRlZC9tdXRhdGVkIGVsZW1lbnRcbiAqXHRAcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDb21wb25lbnRGcm9tVk5vZGUoZG9tLCB2bm9kZSwgY29udGV4dCwgbW91bnRBbGwpIHtcblx0bGV0IGMgPSBkb20gJiYgZG9tLl9jb21wb25lbnQsXG5cdFx0b2xkRG9tID0gZG9tLFxuXHRcdGlzRGlyZWN0T3duZXIgPSBjICYmIGRvbS5fY29tcG9uZW50Q29uc3RydWN0b3I9PT12bm9kZS5ub2RlTmFtZSxcblx0XHRpc093bmVyID0gaXNEaXJlY3RPd25lcixcblx0XHRwcm9wcyA9IGdldE5vZGVQcm9wcyh2bm9kZSk7XG5cdHdoaWxlIChjICYmICFpc093bmVyICYmIChjPWMuX3BhcmVudENvbXBvbmVudCkpIHtcblx0XHRpc093bmVyID0gYy5jb25zdHJ1Y3Rvcj09PXZub2RlLm5vZGVOYW1lO1xuXHR9XG5cblx0aWYgKGMgJiYgaXNPd25lciAmJiAoIW1vdW50QWxsIHx8IGMuX2NvbXBvbmVudCkpIHtcblx0XHRzZXRDb21wb25lbnRQcm9wcyhjLCBwcm9wcywgQVNZTkNfUkVOREVSLCBjb250ZXh0LCBtb3VudEFsbCk7XG5cdFx0ZG9tID0gYy5iYXNlO1xuXHR9XG5cdGVsc2Uge1xuXHRcdGlmIChjICYmICFpc0RpcmVjdE93bmVyKSB7XG5cdFx0XHR1bm1vdW50Q29tcG9uZW50KGMsIHRydWUpO1xuXHRcdFx0ZG9tID0gb2xkRG9tID0gbnVsbDtcblx0XHR9XG5cblx0XHRjID0gY3JlYXRlQ29tcG9uZW50KHZub2RlLm5vZGVOYW1lLCBwcm9wcywgY29udGV4dCk7XG5cdFx0aWYgKGRvbSAmJiAhYy5uZXh0QmFzZSkge1xuXHRcdFx0Yy5uZXh0QmFzZSA9IGRvbTtcblx0XHRcdC8vIHBhc3NpbmcgZG9tL29sZERvbSBhcyBuZXh0QmFzZSB3aWxsIHJlY3ljbGUgaXQgaWYgdW51c2VkLCBzbyBieXBhc3MgcmVjeWNsaW5nIG9uIEwyNDE6XG5cdFx0XHRvbGREb20gPSBudWxsO1xuXHRcdH1cblx0XHRzZXRDb21wb25lbnRQcm9wcyhjLCBwcm9wcywgU1lOQ19SRU5ERVIsIGNvbnRleHQsIG1vdW50QWxsKTtcblx0XHRkb20gPSBjLmJhc2U7XG5cblx0XHRpZiAob2xkRG9tICYmIGRvbSE9PW9sZERvbSkge1xuXHRcdFx0b2xkRG9tLl9jb21wb25lbnQgPSBudWxsO1xuXHRcdFx0cmVjb2xsZWN0Tm9kZVRyZWUob2xkRG9tKTtcblx0XHR9XG5cdH1cblxuXHRyZXR1cm4gZG9tO1xufVxuXG5cblxuLyoqIFJlbW92ZSBhIGNvbXBvbmVudCBmcm9tIHRoZSBET00gYW5kIHJlY3ljbGUgaXQuXG4gKlx0QHBhcmFtIHtFbGVtZW50fSBkb21cdFx0XHRBIERPTSBub2RlIGZyb20gd2hpY2ggdG8gdW5tb3VudCB0aGUgZ2l2ZW4gQ29tcG9uZW50XG4gKlx0QHBhcmFtIHtDb21wb25lbnR9IGNvbXBvbmVudFx0VGhlIENvbXBvbmVudCBpbnN0YW5jZSB0byB1bm1vdW50XG4gKlx0QHByaXZhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVubW91bnRDb21wb25lbnQoY29tcG9uZW50LCByZW1vdmUpIHtcblx0aWYgKG9wdGlvbnMuYmVmb3JlVW5tb3VudCkgb3B0aW9ucy5iZWZvcmVVbm1vdW50KGNvbXBvbmVudCk7XG5cblx0Ly8gY29uc29sZS5sb2coYCR7cmVtb3ZlPydSZW1vdmluZyc6J1VubW91bnRpbmcnfSBjb21wb25lbnQ6ICR7Y29tcG9uZW50LmNvbnN0cnVjdG9yLm5hbWV9YCk7XG5cdGxldCBiYXNlID0gY29tcG9uZW50LmJhc2U7XG5cblx0Y29tcG9uZW50Ll9kaXNhYmxlID0gdHJ1ZTtcblxuXHRpZiAoY29tcG9uZW50LmNvbXBvbmVudFdpbGxVbm1vdW50KSBjb21wb25lbnQuY29tcG9uZW50V2lsbFVubW91bnQoKTtcblxuXHRjb21wb25lbnQuYmFzZSA9IG51bGw7XG5cblx0Ly8gcmVjdXJzaXZlbHkgdGVhciBkb3duICYgcmVjb2xsZWN0IGhpZ2gtb3JkZXIgY29tcG9uZW50IGNoaWxkcmVuOlxuXHRsZXQgaW5uZXIgPSBjb21wb25lbnQuX2NvbXBvbmVudDtcblx0aWYgKGlubmVyKSB7XG5cdFx0dW5tb3VudENvbXBvbmVudChpbm5lciwgcmVtb3ZlKTtcblx0fVxuXHRlbHNlIGlmIChiYXNlKSB7XG5cdFx0aWYgKGJhc2VbQVRUUl9LRVldICYmIGJhc2VbQVRUUl9LRVldLnJlZikgYmFzZVtBVFRSX0tFWV0ucmVmKG51bGwpO1xuXG5cdFx0Y29tcG9uZW50Lm5leHRCYXNlID0gYmFzZTtcblxuXHRcdGlmIChyZW1vdmUpIHtcblx0XHRcdHJlbW92ZU5vZGUoYmFzZSk7XG5cdFx0XHRjb2xsZWN0Q29tcG9uZW50KGNvbXBvbmVudCk7XG5cdFx0fVxuXHRcdGxldCBjO1xuXHRcdHdoaWxlICgoYz1iYXNlLmxhc3RDaGlsZCkpIHJlY29sbGVjdE5vZGVUcmVlKGMsICFyZW1vdmUpO1xuXHRcdC8vIHJlbW92ZU9ycGhhbmVkQ2hpbGRyZW4oYmFzZS5jaGlsZE5vZGVzLCB0cnVlKTtcblx0fVxuXG5cdGlmIChjb21wb25lbnQuX19yZWYpIGNvbXBvbmVudC5fX3JlZihudWxsKTtcblx0aWYgKGNvbXBvbmVudC5jb21wb25lbnREaWRVbm1vdW50KSBjb21wb25lbnQuY29tcG9uZW50RGlkVW5tb3VudCgpO1xufVxuIiwiaW1wb3J0IHsgRk9SQ0VfUkVOREVSIH0gZnJvbSAnLi9jb25zdGFudHMnO1xuaW1wb3J0IHsgZXh0ZW5kLCBjbG9uZSwgaXNGdW5jdGlvbiB9IGZyb20gJy4vdXRpbCc7XG5pbXBvcnQgeyBjcmVhdGVMaW5rZWRTdGF0ZSB9IGZyb20gJy4vbGlua2VkLXN0YXRlJztcbmltcG9ydCB7IHJlbmRlckNvbXBvbmVudCB9IGZyb20gJy4vdmRvbS9jb21wb25lbnQnO1xuaW1wb3J0IHsgZW5xdWV1ZVJlbmRlciB9IGZyb20gJy4vcmVuZGVyLXF1ZXVlJztcblxuLyoqIEJhc2UgQ29tcG9uZW50IGNsYXNzLCBmb3IgaGUgRVM2IENsYXNzIG1ldGhvZCBvZiBjcmVhdGluZyBDb21wb25lbnRzXG4gKlx0QHB1YmxpY1xuICpcbiAqXHRAZXhhbXBsZVxuICpcdGNsYXNzIE15Rm9vIGV4dGVuZHMgQ29tcG9uZW50IHtcbiAqXHRcdHJlbmRlcihwcm9wcywgc3RhdGUpIHtcbiAqXHRcdFx0cmV0dXJuIDxkaXYgLz47XG4gKlx0XHR9XG4gKlx0fVxuICovXG5leHBvcnQgZnVuY3Rpb24gQ29tcG9uZW50KHByb3BzLCBjb250ZXh0KSB7XG5cdC8qKiBAcHJpdmF0ZSAqL1xuXHR0aGlzLl9kaXJ0eSA9IHRydWU7XG5cdC8vIC8qKiBAcHVibGljICovXG5cdC8vIHRoaXMuX2Rpc2FibGVSZW5kZXJpbmcgPSBmYWxzZTtcblx0Ly8gLyoqIEBwdWJsaWMgKi9cblx0Ly8gdGhpcy5wcmV2U3RhdGUgPSB0aGlzLnByZXZQcm9wcyA9IHRoaXMucHJldkNvbnRleHQgPSB0aGlzLmJhc2UgPSB0aGlzLm5leHRCYXNlID0gdGhpcy5fcGFyZW50Q29tcG9uZW50ID0gdGhpcy5fY29tcG9uZW50ID0gdGhpcy5fX3JlZiA9IHRoaXMuX19rZXkgPSB0aGlzLl9saW5rZWRTdGF0ZXMgPSB0aGlzLl9yZW5kZXJDYWxsYmFja3MgPSBudWxsO1xuXHQvKiogQHB1YmxpYyAqL1xuXHR0aGlzLmNvbnRleHQgPSBjb250ZXh0O1xuXHQvKiogQHR5cGUge29iamVjdH0gKi9cblx0dGhpcy5wcm9wcyA9IHByb3BzO1xuXHQvKiogQHR5cGUge29iamVjdH0gKi9cblx0aWYgKCF0aGlzLnN0YXRlKSB0aGlzLnN0YXRlID0ge307XG59XG5cblxuZXh0ZW5kKENvbXBvbmVudC5wcm90b3R5cGUsIHtcblxuXHQvKiogUmV0dXJucyBhIGBib29sZWFuYCB2YWx1ZSBpbmRpY2F0aW5nIGlmIHRoZSBjb21wb25lbnQgc2hvdWxkIHJlLXJlbmRlciB3aGVuIHJlY2VpdmluZyB0aGUgZ2l2ZW4gYHByb3BzYCBhbmQgYHN0YXRlYC5cblx0ICpcdEBwYXJhbSB7b2JqZWN0fSBuZXh0UHJvcHNcblx0ICpcdEBwYXJhbSB7b2JqZWN0fSBuZXh0U3RhdGVcblx0ICpcdEBwYXJhbSB7b2JqZWN0fSBuZXh0Q29udGV4dFxuXHQgKlx0QHJldHVybnMge0Jvb2xlYW59IHNob3VsZCB0aGUgY29tcG9uZW50IHJlLXJlbmRlclxuXHQgKlx0QG5hbWUgc2hvdWxkQ29tcG9uZW50VXBkYXRlXG5cdCAqXHRAZnVuY3Rpb25cblx0ICovXG5cdC8vIHNob3VsZENvbXBvbmVudFVwZGF0ZSgpIHtcblx0Ly8gXHRyZXR1cm4gdHJ1ZTtcblx0Ly8gfSxcblxuXG5cdC8qKiBSZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCBzZXRzIGEgc3RhdGUgcHJvcGVydHkgd2hlbiBjYWxsZWQuXG5cdCAqXHRDYWxsaW5nIGxpbmtTdGF0ZSgpIHJlcGVhdGVkbHkgd2l0aCB0aGUgc2FtZSBhcmd1bWVudHMgcmV0dXJucyBhIGNhY2hlZCBsaW5rIGZ1bmN0aW9uLlxuXHQgKlxuXHQgKlx0UHJvdmlkZXMgc29tZSBidWlsdC1pbiBzcGVjaWFsIGNhc2VzOlxuXHQgKlx0XHQtIENoZWNrYm94ZXMgYW5kIHJhZGlvIGJ1dHRvbnMgbGluayB0aGVpciBib29sZWFuIGBjaGVja2VkYCB2YWx1ZVxuXHQgKlx0XHQtIElucHV0cyBhdXRvbWF0aWNhbGx5IGxpbmsgdGhlaXIgYHZhbHVlYCBwcm9wZXJ0eVxuXHQgKlx0XHQtIEV2ZW50IHBhdGhzIGZhbGwgYmFjayB0byBhbnkgYXNzb2NpYXRlZCBDb21wb25lbnQgaWYgbm90IGZvdW5kIG9uIGFuIGVsZW1lbnRcblx0ICpcdFx0LSBJZiBsaW5rZWQgdmFsdWUgaXMgYSBmdW5jdGlvbiwgd2lsbCBpbnZva2UgaXQgYW5kIHVzZSB0aGUgcmVzdWx0XG5cdCAqXG5cdCAqXHRAcGFyYW0ge3N0cmluZ30ga2V5XHRcdFx0XHRUaGUgcGF0aCB0byBzZXQgLSBjYW4gYmUgYSBkb3Qtbm90YXRlZCBkZWVwIGtleVxuXHQgKlx0QHBhcmFtIHtzdHJpbmd9IFtldmVudFBhdGhdXHRcdElmIHNldCwgYXR0ZW1wdHMgdG8gZmluZCB0aGUgbmV3IHN0YXRlIHZhbHVlIGF0IGEgZ2l2ZW4gZG90LW5vdGF0ZWQgcGF0aCB3aXRoaW4gdGhlIG9iamVjdCBwYXNzZWQgdG8gdGhlIGxpbmtlZFN0YXRlIHNldHRlci5cblx0ICpcdEByZXR1cm5zIHtmdW5jdGlvbn0gbGlua1N0YXRlU2V0dGVyKGUpXG5cdCAqXG5cdCAqXHRAZXhhbXBsZSBVcGRhdGUgYSBcInRleHRcIiBzdGF0ZSB2YWx1ZSB3aGVuIGFuIGlucHV0IGNoYW5nZXM6XG5cdCAqXHRcdDxpbnB1dCBvbkNoYW5nZT17IHRoaXMubGlua1N0YXRlKCd0ZXh0JykgfSAvPlxuXHQgKlxuXHQgKlx0QGV4YW1wbGUgU2V0IGEgZGVlcCBzdGF0ZSB2YWx1ZSBvbiBjbGlja1xuXHQgKlx0XHQ8YnV0dG9uIG9uQ2xpY2s9eyB0aGlzLmxpbmtTdGF0ZSgndG91Y2guY29vcmRzJywgJ3RvdWNoZXMuMCcpIH0+VGFwPC9idXR0b25cblx0ICovXG5cdGxpbmtTdGF0ZShrZXksIGV2ZW50UGF0aCkge1xuXHRcdGxldCBjID0gdGhpcy5fbGlua2VkU3RhdGVzIHx8ICh0aGlzLl9saW5rZWRTdGF0ZXMgPSB7fSk7XG5cdFx0cmV0dXJuIGNba2V5K2V2ZW50UGF0aF0gfHwgKGNba2V5K2V2ZW50UGF0aF0gPSBjcmVhdGVMaW5rZWRTdGF0ZSh0aGlzLCBrZXksIGV2ZW50UGF0aCkpO1xuXHR9LFxuXG5cblx0LyoqIFVwZGF0ZSBjb21wb25lbnQgc3RhdGUgYnkgY29weWluZyBwcm9wZXJ0aWVzIGZyb20gYHN0YXRlYCB0byBgdGhpcy5zdGF0ZWAuXG5cdCAqXHRAcGFyYW0ge29iamVjdH0gc3RhdGVcdFx0QSBoYXNoIG9mIHN0YXRlIHByb3BlcnRpZXMgdG8gdXBkYXRlIHdpdGggbmV3IHZhbHVlc1xuXHQgKi9cblx0c2V0U3RhdGUoc3RhdGUsIGNhbGxiYWNrKSB7XG5cdFx0bGV0IHMgPSB0aGlzLnN0YXRlO1xuXHRcdGlmICghdGhpcy5wcmV2U3RhdGUpIHRoaXMucHJldlN0YXRlID0gY2xvbmUocyk7XG5cdFx0ZXh0ZW5kKHMsIGlzRnVuY3Rpb24oc3RhdGUpID8gc3RhdGUocywgdGhpcy5wcm9wcykgOiBzdGF0ZSk7XG5cdFx0aWYgKGNhbGxiYWNrKSAodGhpcy5fcmVuZGVyQ2FsbGJhY2tzID0gKHRoaXMuX3JlbmRlckNhbGxiYWNrcyB8fCBbXSkpLnB1c2goY2FsbGJhY2spO1xuXHRcdGVucXVldWVSZW5kZXIodGhpcyk7XG5cdH0sXG5cblxuXHQvKiogSW1tZWRpYXRlbHkgcGVyZm9ybSBhIHN5bmNocm9ub3VzIHJlLXJlbmRlciBvZiB0aGUgY29tcG9uZW50LlxuXHQgKlx0QHByaXZhdGVcblx0ICovXG5cdGZvcmNlVXBkYXRlKCkge1xuXHRcdHJlbmRlckNvbXBvbmVudCh0aGlzLCBGT1JDRV9SRU5ERVIpO1xuXHR9LFxuXG5cblx0LyoqIEFjY2VwdHMgYHByb3BzYCBhbmQgYHN0YXRlYCwgYW5kIHJldHVybnMgYSBuZXcgVmlydHVhbCBET00gdHJlZSB0byBidWlsZC5cblx0ICpcdFZpcnR1YWwgRE9NIGlzIGdlbmVyYWxseSBjb25zdHJ1Y3RlZCB2aWEgW0pTWF0oaHR0cDovL2phc29uZm9ybWF0LmNvbS93dGYtaXMtanN4KS5cblx0ICpcdEBwYXJhbSB7b2JqZWN0fSBwcm9wc1x0XHRQcm9wcyAoZWc6IEpTWCBhdHRyaWJ1dGVzKSByZWNlaXZlZCBmcm9tIHBhcmVudCBlbGVtZW50L2NvbXBvbmVudFxuXHQgKlx0QHBhcmFtIHtvYmplY3R9IHN0YXRlXHRcdFRoZSBjb21wb25lbnQncyBjdXJyZW50IHN0YXRlXG5cdCAqXHRAcGFyYW0ge29iamVjdH0gY29udGV4dFx0XHRDb250ZXh0IG9iamVjdCAoaWYgYSBwYXJlbnQgY29tcG9uZW50IGhhcyBwcm92aWRlZCBjb250ZXh0KVxuXHQgKlx0QHJldHVybnMgVk5vZGVcblx0ICovXG5cdHJlbmRlcigpIHt9XG5cbn0pO1xuIiwiaW1wb3J0IHsgZGlmZiB9IGZyb20gJy4vdmRvbS9kaWZmJztcblxuLyoqIFJlbmRlciBKU1ggaW50byBhIGBwYXJlbnRgIEVsZW1lbnQuXG4gKlx0QHBhcmFtIHtWTm9kZX0gdm5vZGVcdFx0QSAoSlNYKSBWTm9kZSB0byByZW5kZXJcbiAqXHRAcGFyYW0ge0VsZW1lbnR9IHBhcmVudFx0XHRET00gZWxlbWVudCB0byByZW5kZXIgaW50b1xuICpcdEBwYXJhbSB7RWxlbWVudH0gW21lcmdlXVx0QXR0ZW1wdCB0byByZS11c2UgYW4gZXhpc3RpbmcgRE9NIHRyZWUgcm9vdGVkIGF0IGBtZXJnZWBcbiAqXHRAcHVibGljXG4gKlxuICpcdEBleGFtcGxlXG4gKlx0Ly8gcmVuZGVyIGEgZGl2IGludG8gPGJvZHk+OlxuICpcdHJlbmRlcig8ZGl2IGlkPVwiaGVsbG9cIj5oZWxsbyE8L2Rpdj4sIGRvY3VtZW50LmJvZHkpO1xuICpcbiAqXHRAZXhhbXBsZVxuICpcdC8vIHJlbmRlciBhIFwiVGhpbmdcIiBjb21wb25lbnQgaW50byAjZm9vOlxuICpcdGNvbnN0IFRoaW5nID0gKHsgbmFtZSB9KSA9PiA8c3Bhbj57IG5hbWUgfTwvc3Bhbj47XG4gKlx0cmVuZGVyKDxUaGluZyBuYW1lPVwib25lXCIgLz4sIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJyNmb28nKSk7XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXIodm5vZGUsIHBhcmVudCwgbWVyZ2UpIHtcblx0cmV0dXJuIGRpZmYobWVyZ2UsIHZub2RlLCB7fSwgZmFsc2UsIHBhcmVudCk7XG59XG4iLCJjbGFzcyBFdmVudHMge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLnRhcmdldHMgPSB7fTtcbiAgfVxuICBvbihldmVudFR5cGUsIGZuKSB7XG4gICAgdGhpcy50YXJnZXRzW2V2ZW50VHlwZV0gPSB0aGlzLnRhcmdldHNbZXZlbnRUeXBlXSB8fCBbXTtcbiAgICB0aGlzLnRhcmdldHNbZXZlbnRUeXBlXS5wdXNoKGZuKTtcbiAgfVxuICBvZmYoZXZlbnRUeXBlLCBmbikge1xuICAgIHRoaXMudGFyZ2V0c1tldmVudFR5cGVdID0gdGhpcy50YXJnZXRzW2V2ZW50VHlwZV0uZmlsdGVyKCh0KSA9PiB0ICE9PSBmbik7XG4gIH1cbiAgZmlyZShldmVudFR5cGUsIC4uLmFyZ3MpIHtcbiAgICAodGhpcy50YXJnZXRzW2V2ZW50VHlwZV0gfHwgW10pLmZvckVhY2goKGZuKSA9PiBmbiguLi5hcmdzKSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgRXZlbnRzO1xuIiwiaW1wb3J0IHsgaCB9IGZyb20gJ3ByZWFjdCc7XG5cbmNvbnN0IFNWR1N5bWJvbHMgPSAoKSA9PiAoXG4gIDxkaXYgc3R5bGU9XCJkaXNwbGF5OmJsb2NrO3dpZHRoOjA7aGVpZ2h0OjA7XCI+XG4gICAgPHN2Zz5cbiAgICAgIDxzeW1ib2wgaWQ9XCJhZGQtcGhvdG9cIiB2aWV3Qm94PVwiMCAwIDY2IDY2XCI+XG4gICAgICAgIDxnIHRyYW5zZm9ybT1cInRyYW5zbGF0ZSgxIDEpXCIgc3Ryb2tlLXdpZHRoPVwiMlwiIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiIGZpbGw9XCJub25lXCIgZmlsbC1ydWxlPVwiZXZlbm9kZFwiPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNDIuMzQzIDQxLjk1OGMtMy45MzItLjgyOC04Ljc4Ni0xLjQyNS0xNC42MS0xLjQyNS0xMS44ODIgMC0xOS43MjcgMi40ODctMjMuOTUgNC4zNkE2LjM3NiA2LjM3NiAwIDAgMCAwIDUwLjczOHYxMS4xMjloMzQuMTMzTTEyLjggMTQuOTMzQzEyLjggNi42ODYgMTkuNDg2IDAgMjcuNzMzIDBjOC4yNDggMCAxNC45MzQgNi42ODYgMTQuOTM0IDE0LjkzM0M0Mi42NjcgMjMuMTgxIDM1Ljk4IDMyIDI3LjczMyAzMiAxOS40ODYgMzIgMTIuOCAyMy4xOCAxMi44IDE0LjkzM3pNNTEuMiA0Ni45MzN2OC41MzRNNDYuOTMzIDUxLjJoOC41MzRcIi8+XG4gICAgICAgICAgPGNpcmNsZSBjeD1cIjUxLjJcIiBjeT1cIjUxLjJcIiByPVwiMTIuOFwiLz5cbiAgICAgICAgPC9nPlxuICAgICAgPC9zeW1ib2w+XG4gICAgICA8c3ltYm9sIGlkPVwidXBsb2FkXCIgdmlld0JveD1cIjAgMCAyMCAxNFwiPlxuICAgICAgICA8cGF0aCBkPVwiTTE2LjcxIDUuODM5QzE2LjI1OCAyLjQ4NCAxMy40MiAwIDEwIDBhNi43MzIgNi43MzIgMCAwIDAtNi40MiA0LjYxM0MxLjQ4NSA1LjA2NSAwIDYuODcgMCA5LjAzM2MwIDIuMzU0IDEuODM5IDQuMzIyIDQuMTk0IDQuNTE1aDEyLjI5YzEuOTY4LS4xOTMgMy41MTYtMS44NyAzLjUxNi0zLjg3YTMuOTEzIDMuOTEzIDAgMCAwLTMuMjktMy44NHptLTMuMjU4IDEuODA2YS4yOTMuMjkzIDAgMCAxLS4yMjYuMDk3LjI5My4yOTMgMCAwIDEtLjIyNi0uMDk3bC0yLjY3Ny0yLjY3N3Y2LjMyMmMwIC4xOTQtLjEzLjMyMy0uMzIzLjMyMy0uMTk0IDAtLjMyMy0uMTMtLjMyMy0uMzIzVjQuOTY4TDcgNy42NDVhLjMxMi4zMTIgMCAwIDEtLjQ1MiAwIC4zMTIuMzEyIDAgMCAxIDAtLjQ1MWwzLjIyNi0zLjIyNmMuMDMyLS4wMzMuMDY1LS4wNjUuMDk3LS4wNjUuMDY0LS4wMzIuMTYxLS4wMzIuMjU4IDAgLjAzMi4wMzIuMDY1LjAzMi4wOTcuMDY1bDMuMjI2IDMuMjI2YS4zMTIuMzEyIDAgMCAxIDAgLjQ1MXpcIiBzdHJva2U9XCJub25lXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiIGZpbGwtcnVsZT1cImV2ZW5vZGRcIi8+XG4gICAgICA8L3N5bWJvbD5cbiAgICAgIDxzeW1ib2wgaWQ9XCJ0YWtlLXBpY3R1cmVcIiB2aWV3Qm94PVwiMCAwIDE4IDE2XCI+XG4gICAgICAgIDxwYXRoIGQ9XCJNNi4wOTcgMS4xNjFIMi4wMzJ2LS44N2MwLS4xNi4xMy0uMjkxLjI5LS4yOTFoMy40ODRjLjE2IDAgLjI5LjEzLjI5LjI5di44NzF6TTE3LjQyIDEuNzQySC41OGEuNTguNTggMCAwIDAtLjU4LjU4djEyLjc3NWMwIC4zMi4yNi41OC41OC41OGgxNi44NGMuMzIgMCAuNTgtLjI2LjU4LS41OFYyLjMyM2EuNTguNTggMCAwIDAtLjU4LS41ODF6TTQuMDY0IDUuNTE2YS41ODEuNTgxIDAgMSAxIDAtMS4xNjIuNTgxLjU4MSAwIDAgMSAwIDEuMTYyem03LjI1OCA3LjI1OEEzLjc3OSAzLjc3OSAwIDAgMSA3LjU0OCA5YTMuNzc5IDMuNzc5IDAgMCAxIDMuNzc1LTMuNzc0QTMuNzc5IDMuNzc5IDAgMCAxIDE1LjA5NyA5YTMuNzc5IDMuNzc5IDAgMCAxLTMuNzc0IDMuNzc0elwiIHN0cm9rZT1cIm5vbmVcIiBmaWxsPVwiY3VycmVudENvbG9yXCIgZmlsbC1ydWxlPVwiZXZlbm9kZFwiLz5cbiAgICAgIDwvc3ltYm9sPlxuICAgICAgPHN5bWJvbCBpZD1cImNyb3BcIiB2aWV3Qm94PVwiMCAwIDE4IDE4XCI+XG4gICAgICAgIDxnIHN0cm9rZS13aWR0aD1cIjJcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBmaWxsPVwibm9uZVwiIGZpbGwtcnVsZT1cImV2ZW5vZGRcIj5cbiAgICAgICAgICA8cGF0aCBkPVwiTTQuMDkgMHY0LjkxTTEzLjkxIDE2LjM2NFYxOE0wIDQuOTFoMTMuOTF2OC4xOFwiLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTQuMDkgOC4xODJ2NC45MDlIMThcIi8+XG4gICAgICAgIDwvZz5cbiAgICAgIDwvc3ltYm9sPlxuICAgICAgPHN5bWJvbCBpZD1cImZpbHRlcnNcIiB2aWV3Qm94PVwiMCAwIDE4IDE4XCI+XG4gICAgICAgIDxnIHN0cm9rZT1cIm5vbmVcIiBmaWxsPVwiY3VycmVudENvbG9yXCIgZmlsbC1ydWxlPVwiZXZlbm9kZFwiPlxuICAgICAgICAgIDxjaXJjbGUgY3g9XCI5XCIgY3k9XCI1LjI1XCIgcj1cIjUuMjVcIi8+XG4gICAgICAgICAgPHBhdGggZD1cIk0xNS4xMzEgOC4wNzVhNi43NDggNi43NDggMCAwIDEtMy4yNzUgMy4yOSA2LjcxNyA2LjcxNyAwIDAgMS0xLjY2NCA1Ljk2OEE1LjI1IDUuMjUgMCAwIDAgMTggMTIuNzVhNS4yNDYgNS4yNDYgMCAwIDAtMi44NjktNC42NzZ6TTkgMTJjLTIuNzEzIDAtNS4wNTMtMS42MTMtNi4xMjQtMy45MjhBNS4yNDUgNS4yNDUgMCAwIDAgMCAxMi43NWE1LjI1IDUuMjUgMCAxIDAgMTAuNSAwYzAtLjMwOC0uMDMyLS42MDktLjA4My0uOTAyQzkuOTYgMTEuOTQ2IDkuNDg2IDEyIDkgMTJ6XCIvPlxuICAgICAgICA8L2c+XG4gICAgICA8L3N5bWJvbD5cbiAgICAgIDxzeW1ib2wgaWQ9XCJjaGVja1wiIHZpZXdCb3g9XCIwIDAgMTggMTVcIj5cbiAgICAgICAgPHBhdGggZD1cIk02LjMgMTQuNEwwIDguMWwyLjctMi43TDYuMyA5bDktOUwxOCAyLjd6XCIgc3Ryb2tlPVwibm9uZVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIiBmaWxsLXJ1bGU9XCJldmVub2RkXCIvPlxuICAgICAgPC9zeW1ib2w+XG4gICAgPC9zdmc+XG4gIDwvZGl2PlxuKTtcblxuZXhwb3J0IGRlZmF1bHQgU1ZHU3ltYm9scztcbiIsImltcG9ydCB7IGggfSBmcm9tICdwcmVhY3QnO1xuXG5jb25zdCBJY29uID0gKHsgbmFtZSB9KSA9PiB7XG4gIHJldHVybiAoXG4gICAgPHN2Zz5cbiAgICAgIDx1c2UgeGxpbmtIcmVmPXtgIyR7bmFtZX1gfT48L3VzZT5cbiAgICA8L3N2Zz5cbiAgKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IEljb247XG4iLCJleHBvcnQgY29uc3QgaGV4VG9SZ2IgPSAoX2hleCkgPT4ge1xuICBsZXQgaGV4ID0gX2hleDtcbiAgaWYgKGhleFswXSAhPT0gJyMnKSB7XG4gICAgaGV4ID0gYCMke2hleH1gO1xuICB9XG4gIGlmIChoZXgubGVuZ3RoID09PSA0KSB7XG4gICAgY29uc3QgciA9IHBhcnNlSW50KGhleC5zbGljZSgxLCAyKSArIGhleC5zbGljZSgxLCAyKSwgMTYpLFxuICAgICAgICAgIGcgPSBwYXJzZUludChoZXguc2xpY2UoMiwgMykgKyBoZXguc2xpY2UoMiwgMyksIDE2KSxcbiAgICAgICAgICBiID0gcGFyc2VJbnQoaGV4LnNsaWNlKDMsIDQpICsgaGV4LnNsaWNlKDMsIDQpLCAxNik7XG4gICAgcmV0dXJuIHsgciwgZywgYiB9O1xuICB9XG4gIGlmIChoZXgubGVuZ3RoID09PSA3KSB7XG4gICAgY29uc3QgciA9IHBhcnNlSW50KGhleC5zbGljZSgxLCAzKSwgMTYpLFxuICAgICAgICAgIGcgPSBwYXJzZUludChoZXguc2xpY2UoMywgNSksIDE2KSxcbiAgICAgICAgICBiID0gcGFyc2VJbnQoaGV4LnNsaWNlKDUsIDcpLCAxNik7XG4gICAgcmV0dXJuIHsgciwgZywgYiB9O1xuICB9XG4gIHRocm93IG5ldyBFcnJvcignQmFkIGhleCBwcm92aWRlZCcpO1xufTtcblxuZXhwb3J0IGNvbnN0IHJnYmEgPSAoeyByLCBnLCBiIH0sIGFscGhhID0gMSkgPT4ge1xuICByZXR1cm4gYHJnYmEoJHtyfSwgJHtnfSwgJHtifSwgJHthbHBoYX0pYDtcbn07XG5cbmV4cG9ydCBjb25zdCBoZXhUb1JnYmEgPSAoaGV4LCBhbHBoYSA9IDEpID0+IHtcbiAgcmV0dXJuIHJnYmEoaGV4VG9SZ2IoaGV4KSwgYWxwaGEpO1xufTtcbiIsImltcG9ydCB7IGgsIENvbXBvbmVudCB9IGZyb20gJ3ByZWFjdCc7XG5pbXBvcnQgeyBoZXhUb1JnYiwgaGV4VG9SZ2JhIH0gZnJvbSAnLi4vdXRpbC9jb2xvcic7XG5cbmNvbnN0IHdpdGhDU1MgPSAoV3JhcHBlZENvbXBvbmVudCwgY3NzKSA9PiB7XG4gIGNsYXNzIFdpdGhDU1MgZXh0ZW5kcyBDb21wb25lbnQge1xuICAgIGNvbXBvbmVudFdpbGxNb3VudCgpIHtcbiAgICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLmNvbnRleHQub3B0aW9ucyB8fCB0aGlzLnByb3BzLm9wdGlvbnM7XG4gICAgICBjb25zdCB7IHRoZW1lLCBjb2xvcnMsIGNsYXNzTmFtZSwgc2l6ZSB9ID0gb3B0aW9ucztcbiAgICAgIHRoaXMuJHN0eWxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgICAgIGRvY3VtZW50LmhlYWQuaW5zZXJ0QmVmb3JlKHRoaXMuJHN0eWxlLCBkb2N1bWVudC5oZWFkLmZpcnN0Q2hpbGQpO1xuXG4gICAgICBjb25zdCBwcmltYXJ5Q29sb3IgPSBoZXhUb1JnYihjb2xvcnMuYmFzZSk7XG4gICAgICBjb25zdCBzZWNvbmRhcnlDb2xvciA9IGhleFRvUmdiKGNvbG9ycy5hY2NlbnQpO1xuICAgICAgY29uc3QgdGVydGlhcnlDb2xvciA9IGhleFRvUmdiKGNvbG9ycy5lbXBoYXNpcyk7XG4gICAgICBjb25zdCBzZXR0aW5ncyA9IHtcbiAgICAgICAgY2xhc3NOYW1lLCBzaXplLCBwcmltYXJ5Q29sb3IsIHNlY29uZGFyeUNvbG9yLCB0ZXJ0aWFyeUNvbG9yLFxuICAgICAgfTtcbiAgICAgIGNvbnN0IHJ1bGVzID0gKFxuICAgICAgICBjc3Moc2V0dGluZ3MsIHRoaXMucHJvcHMpXG4gICAgICAgICAgLnNwbGl0KC9cXH1cXG5bXFxzXSpcXC4vZylcbiAgICAgICAgICAuZmlsdGVyKChyKSA9PiAhIXIpXG4gICAgICAgICAgLm1hcCgocikgPT4gci50cmltKCkpXG4gICAgICAgICAgLm1hcCgociwgaSwgYXJyKSA9PiB7XG4gICAgICAgICAgICBsZXQgbmV3UiA9IHI7XG4gICAgICAgICAgICBpZiAoclswXSAhPT0gJy4nKSB7XG4gICAgICAgICAgICAgIG5ld1IgPSBgLiR7bmV3Un1gO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJbci5sZW5ndGggLSAxXSAhPT0gJ30nKSB7XG4gICAgICAgICAgICAgIG5ld1IgPSBgJHtuZXdSfX1gO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG5ld1I7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gICAgICBydWxlcy5mb3JFYWNoKChydWxlLCBpKSA9PiB7XG4gICAgICAgIHRoaXMuJHN0eWxlLnNoZWV0Lmluc2VydFJ1bGUocnVsZSwgaSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgY29tcG9uZW50V2lsbFVubW91bnQoKSB7XG4gICAgICB0aGlzLiRzdHlsZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRoaXMuJHN0eWxlKTtcbiAgICB9XG4gICAgcmVuZGVyKCkge1xuICAgICAgcmV0dXJuIDxXcmFwcGVkQ29tcG9uZW50IHsuLi50aGlzLnByb3BzfSAgLz5cbiAgICB9XG4gIH1cbiAgcmV0dXJuIFdpdGhDU1M7XG59XG5cbmV4cG9ydCBkZWZhdWx0IHdpdGhDU1M7IiwiZXhwb3J0IGNvbnN0IGNsYXNzbmFtZXMgPSAoLi4uYXJncykgPT4gKFxuICBhcmdzLnJlZHVjZSgoYWNjLCBjdXJyKSA9PiAoXG4gICAgW10uY29uY2F0KGFjYywgKFxuICAgICAgdHlwZW9mIGN1cnIgPT09ICdzdHJpbmcnXG4gICAgICA/IFtjdXJyXVxuICAgICAgOiBPYmplY3Qua2V5cyhjdXJyKS5maWx0ZXIoKGspID0+ICEhY3VycltrXSlcbiAgICApKVxuICApLCBbXSlcbiAgLmpvaW4oJyAnKVxuKTtcbiIsImltcG9ydCB7IHJnYmEgfSBmcm9tICcuLi8uLi91dGlsL2NvbG9yJztcblxuZXhwb3J0IGRlZmF1bHQgKHsgY2xhc3NOYW1lLCBzaXplLCBwcmltYXJ5Q29sb3IsIHNlY29uZGFyeUNvbG9yLCB0ZXJ0aWFyeUNvbG9yIH0sIHt9KSA9PiAoYFxuICAuJHtjbGFzc05hbWV9LWFjdGlvbkJhciB7XG4gICAgcGFkZGluZzogMTBweDtcbiAgICBmb250LXNpemU6IDA7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hY3Rpb25CYXItbGlzdCB7XG4gICAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xuICAgIGxpc3Qtc3R5bGUtdHlwZTogbm9uZTtcbiAgICBtYXJnaW46IDA7XG4gICAgcGFkZGluZy1sZWZ0OiAwO1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tYWN0aW9uQmFyLWl0ZW0ge1xuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgfVxuICAuJHtjbGFzc05hbWV9LWFjdGlvbkJhci1pdGVtOm5vdCg6bGFzdC1jaGlsZCkge1xuICAgIG1hcmdpbi1yaWdodDogNXB4O1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tYWN0aW9uQmFyLWJ0biB7XG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xuICAgIHdpZHRoOiAzMnB4O1xuICAgIGhlaWdodDogMzJweDtcbiAgICBib3JkZXItcmFkaXVzOiAzcHg7XG4gICAgYmFja2dyb3VuZC1jb2xvcjogJHtyZ2JhKHNlY29uZGFyeUNvbG9yLCAuNSl9O1xuICAgIGNvbG9yOiAke3JnYmEocHJpbWFyeUNvbG9yKX07XG4gICAgY3Vyc29yOiBwb2ludGVyO1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tYWN0aW9uQmFyLWl0ZW0uaXMtc2VsZWN0ZWQgLiR7Y2xhc3NOYW1lfS1hY3Rpb25CYXItYnRuIHtcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiAke3JnYmEoc2Vjb25kYXJ5Q29sb3IpfTtcbiAgfVxuICAuJHtjbGFzc05hbWV9LWFjdGlvbkJhci1pdGVtLmlzLWVtcGhhc2l6ZWQgLiR7Y2xhc3NOYW1lfS1hY3Rpb25CYXItYnRuIHtcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiAke3JnYmEodGVydGlhcnlDb2xvcil9O1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tYWN0aW9uQmFyLWJ0biBzdmcge1xuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICB0b3A6IDUwJTtcbiAgICBsZWZ0OiA1MCU7XG4gICAgdHJhbnNmb3JtOiB0cmFuc2xhdGUoLTUwJSwgLTUwJSk7XG4gICAgZGlzcGxheTogYmxvY2s7XG4gICAgd2lkdGg6IDE4cHg7XG4gICAgaGVpZ2h0OiAxOHB4O1xuICB9XG5gKTsiLCJpbXBvcnQgeyBoLCBjbG9uZUVsZW1lbnQgfSBmcm9tICdwcmVhY3QnO1xuaW1wb3J0IEljb24gZnJvbSAnLi4vSWNvbic7XG5pbXBvcnQgd2l0aENTUyBmcm9tICcuLi93aXRoQ1NTJztcbmltcG9ydCB7IGNsYXNzbmFtZXMgfSBmcm9tICcuLi8uLi91dGlsL2NsYXNzbmFtZXMnO1xuaW1wb3J0IGNzcyBmcm9tICcuL1Bob3RvQm94QWN0aW9uQmFyLmNzcy5qcyc7XG5cbmV4cG9ydCBjb25zdCBQaG90b0JveEFjdGlvbkJhckl0ZW0gPSAoXG4gICh7IGljb24sIGlzU2VsZWN0ZWQsIG9uUHJlc3MsIGlzRW1waGFzaXplZCB9LCB7IG9wdGlvbnMgfSkgPT4ge1xuICAgIGNvbnN0IHsgY2xhc3NOYW1lIH0gPSBvcHRpb25zO1xuICAgIHJldHVybiAoXG4gICAgICA8bGkgY2xhc3M9e2NsYXNzbmFtZXMoe1xuICAgICAgICBbYCR7Y2xhc3NOYW1lfS1hY3Rpb25CYXItaXRlbWBdOiB0cnVlLFxuICAgICAgICAnaXMtc2VsZWN0ZWQnOiBpc1NlbGVjdGVkLFxuICAgICAgICAnaXMtZW1waGFzaXplZCc6IGlzRW1waGFzaXplZCxcbiAgICAgIH0pfT5cbiAgICAgICAgPGRpdiBjbGFzcz17YCR7Y2xhc3NOYW1lfS1hY3Rpb25CYXItYnRuYH0gb25DbGljaz17b25QcmVzc30+XG4gICAgICAgICAgPEljb24gbmFtZT17aWNvbn0gLz5cbiAgICAgICAgPC9kaXY+XG4gICAgICA8L2xpPlxuICAgICk7XG4gIH1cbik7XG5cbmV4cG9ydCBjb25zdCBQaG90b0JveEFjdGlvbkJhckxpc3QgPSAoeyBjaGlsZHJlbiB9LCB7IG9wdGlvbnMgfSkgPT4ge1xuICBjb25zdCB7IGNsYXNzTmFtZSB9ID0gb3B0aW9ucztcbiAgcmV0dXJuIChcbiAgICA8dWwgY2xhc3M9e2Ake2NsYXNzTmFtZX0tYWN0aW9uQmFyLWxpc3RgfT5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L3VsPlxuICApO1xufTtcblxuZXhwb3J0IGNvbnN0IFBob3RvQm94QWN0aW9uQmFyID0gd2l0aENTUygoeyBjaGlsZHJlbiB9LCB7IG9wdGlvbnMgfSkgPT4ge1xuICBjb25zdCB7IGNsYXNzTmFtZSB9ID0gb3B0aW9ucztcbiAgcmV0dXJuIChcbiAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LWFjdGlvbkJhcmB9PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufSwgY3NzKTtcbiIsImltcG9ydCB7IHJnYmEgfSBmcm9tICcuLi8uLi91dGlsL2NvbG9yJztcblxuZXhwb3J0IGRlZmF1bHQgKHsgY2xhc3NOYW1lLCBzaXplLCBwcmltYXJ5Q29sb3IsIHNlY29uZGFyeUNvbG9yIH0sIHt9KSA9PiAoYFxuICAuJHtjbGFzc05hbWV9LXN0ZXAxLWFjdGlvbkJveCB7XG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xuICAgIHdpZHRoOiAke3NpemV9cHg7XG4gICAgaGVpZ2h0OiAke3NpemV9cHg7XG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xuICAgIGN1cnNvcjogcG9pbnRlcjtcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiAke3JnYmEocHJpbWFyeUNvbG9yKX07XG4gICAgYm9yZGVyOiAycHggZGFzaGVkICR7cmdiYShzZWNvbmRhcnlDb2xvciwgMSl9O1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tc3RlcDEtYWN0aW9uQm94LWNvbnRlbnQge1xuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICB0b3A6IDUwJTtcbiAgICBsZWZ0OiA1MCU7XG4gICAgd2lkdGg6IDEwMCU7XG4gICAgcGFkZGluZzogMCAxMHB4O1xuICAgIHRyYW5zZm9ybTogdHJhbnNsYXRlKC01MCUsIC01MCUpO1xuICAgIGRpc3BsYXk6IGJsb2NrO1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tc3RlcDEtYWN0aW9uQm94LWNvbnRlbnQtcGljV3JhcCB7XG4gICAgZGlzcGxheTogJHtzaXplID4gMTYwID8gJ2Jsb2NrJyA6ICdub25lJ307XG4gICAgbWFyZ2luLWJvdHRvbTogJHtzaXplIC8gMTJ9cHg7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1zdGVwMS1hY3Rpb25Cb3gtY29udGVudC1waWMge1xuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgICBjb2xvcjogJHtyZ2JhKHNlY29uZGFyeUNvbG9yKX07XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1zdGVwMS1hY3Rpb25Cb3gtY29udGVudC1waWMgc3ZnIHtcbiAgICBkaXNwbGF5OiBibG9jaztcbiAgICB3aWR0aDogJHtzaXplIC8gMy43NX1weDtcbiAgICBoZWlnaHQ6ICR7c2l6ZSAvIDMuNzV9cHg7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1zdGVwMS1hY3Rpb25Cb3gtY29udGVudC1jaG9vc2Uge1xuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgICBwYWRkaW5nLWJvdHRvbTogNHB4O1xuICAgIGJvcmRlci1ib3R0b206IDJweCBzb2xpZCAke3JnYmEoc2Vjb25kYXJ5Q29sb3IpfTtcbiAgICBmb250LXdlaWdodDogYm9sZDtcbiAgICBjb2xvcjogJHtyZ2JhKHNlY29uZGFyeUNvbG9yKX07XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1zdGVwMS1hY3Rpb25Cb3gtY29udGVudC1kcmFnIHtcbiAgICBtYXJnaW4tdG9wOiAxMHB4O1xuICAgIGNvbG9yOiAke3JnYmEoc2Vjb25kYXJ5Q29sb3IsIC41KX07XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1zdGVwMS1hY3Rpb25Cb3gtZmlsZS1jaG9vc2VyIHtcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgdG9wOiAwO1xuICAgIGxlZnQ6IDA7XG4gICAgZGlzcGxheTogYmxvY2s7XG4gICAgd2lkdGg6IDFweDtcbiAgICBoZWlnaHQ6IDFweDtcbiAgICBvcGFjaXR5OiAwO1xuICB9XG5gKTsiLCJleHBvcnQgY29uc3QgZGF0YVVybFRvQmxvYiA9IChkYXRhVVJMKSA9PiB7XG4gIHZhciBCQVNFNjRfTUFSS0VSID0gJztiYXNlNjQsJztcbiAgaWYgKGRhdGFVUkwuaW5kZXhPZihCQVNFNjRfTUFSS0VSKSA9PT0gLTEpIHtcbiAgICB2YXIgcGFydHMgPSBkYXRhVVJMLnNwbGl0KCcsJyk7XG4gICAgdmFyIGNvbnRlbnRUeXBlID0gcGFydHNbMF0uc3BsaXQoJzonKVsxXTtcbiAgICB2YXIgcmF3ID0gcGFydHNbMV07XG5cbiAgICByZXR1cm4gbmV3IEJsb2IoW3Jhd10sIHsgdHlwZTogY29udGVudFR5cGUgfSk7XG4gIH1cblxuICB2YXIgcGFydHMgPSBkYXRhVVJMLnNwbGl0KEJBU0U2NF9NQVJLRVIpO1xuICB2YXIgY29udGVudFR5cGUgPSBwYXJ0c1swXS5zcGxpdCgnOicpWzFdO1xuICB2YXIgcmF3ID0gd2luZG93LmF0b2IocGFydHNbMV0pO1xuICB2YXIgcmF3TGVuZ3RoID0gcmF3Lmxlbmd0aDtcblxuICB2YXIgdUludDhBcnJheSA9IG5ldyBVaW50OEFycmF5KHJhd0xlbmd0aCk7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCByYXdMZW5ndGg7ICsraSkge1xuICAgIHVJbnQ4QXJyYXlbaV0gPSByYXcuY2hhckNvZGVBdChpKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgQmxvYihbdUludDhBcnJheV0sIHsgdHlwZTogY29udGVudFR5cGUgfSk7XG59O1xuXG5leHBvcnQgY29uc3QgZGF0YVVybFRvQmxvYjIgPSAoZGF0YVVybCkgPT4ge1xuICB2YXIgYXJyID0gZGF0YVVybC5zcGxpdCgnLCcpLFxuICAgICAgbWltZSA9IGFyclswXS5tYXRjaCgvOiguKj8pOy8pWzFdLFxuICAgICAgYnN0ciA9IGF0b2IoYXJyWzFdKSxcbiAgICAgIG4gPSBic3RyLmxlbmd0aCxcbiAgICAgIHU4YXJyID0gbmV3IFVpbnQ4QXJyYXkobik7XG4gIHdoaWxlIChuLS0pIHtcbiAgICB1OGFycltuXSA9IGJzdHIuY2hhckNvZGVBdChuKTtcbiAgfVxuICByZXR1cm4gbmV3IEJsb2IoW3U4YXJyXSwgeyB0eXBlOiBtaW1lIH0pO1xufTtcbiIsImltcG9ydCB7IGgsIENvbXBvbmVudCB9IGZyb20gJ3ByZWFjdCc7XG5pbXBvcnQgSWNvbiBmcm9tICcuLi9JY29uJztcbmltcG9ydCB7XG4gIFBob3RvQm94QWN0aW9uQmFyLFxuICBQaG90b0JveEFjdGlvbkJhckxpc3QsXG4gIFBob3RvQm94QWN0aW9uQmFySXRlbVxufSBmcm9tICcuLi9QaG90b0JveEFjdGlvbkJhci9QaG90b0JveEFjdGlvbkJhcic7XG5pbXBvcnQgd2l0aENTUyBmcm9tICcuLi93aXRoQ1NTJztcbmltcG9ydCBjc3MgZnJvbSAnLi9QaG90b0JveFN0ZXAxLmNzcy5qcyc7XG5pbXBvcnQgeyBkYXRhVXJsVG9CbG9iIH0gZnJvbSAnLi4vLi4vdXRpbC9ibG9iJztcblxuY2xhc3MgUGhvdG9Cb3hTdGVwMSBleHRlbmRzIENvbXBvbmVudCB7XG4gIGNvbnN0cnVjdG9yKC4uLmFyZ3MpIHtcbiAgICBzdXBlciguLi5hcmdzKTtcbiAgICB0aGlzLnN0YXRlID0ge307XG4gICAgdGhpcy5oYW5kbGVBY3Rpb25Cb3hDbGljayA9IChlKSA9PiB7XG4gICAgICB0aGlzLiRmaWxlQ2hvb3Nlci5kaXNwYXRjaEV2ZW50KFxuICAgICAgICBuZXcgTW91c2VFdmVudCgnY2xpY2snLCB7XG4gICAgICAgICAgJ3ZpZXcnOiB3aW5kb3csXG4gICAgICAgICAgJ2J1YmJsZXMnOiBmYWxzZSxcbiAgICAgICAgICAnY2FuY2VsYWJsZSc6IHRydWVcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfTtcbiAgICB0aGlzLl9oYW5kbGVGaWxlSW5wdXRDaGFuZ2UgPSAoZSkgPT4ge1xuICAgICAgY29uc3Qgc2VsZWN0ZWRGaWxlID0gZS50YXJnZXQuZmlsZXNbMF07XG4gICAgICBjb25zdCByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpO1xuICAgICAgcmVhZGVyLm9ubG9hZCA9IChlKSA9PiB7XG4gICAgICAgIGNvbnN0IGJhc2U2NERhdGEgPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICAgIHRoaXMucHJvcHMuc2VsZWN0RmlsZSh7XG4gICAgICAgICAgbmFtZTogc2VsZWN0ZWRGaWxlLm5hbWUsXG4gICAgICAgICAgc2l6ZTogc2VsZWN0ZWRGaWxlLnNpemUsXG4gICAgICAgICAgdHlwZTogc2VsZWN0ZWRGaWxlLnR5cGUsXG4gICAgICAgICAgYmFzZTY0OiBiYXNlNjREYXRhLFxuICAgICAgICAgIGJsb2I6IGRhdGFVcmxUb0Jsb2IoYmFzZTY0RGF0YSlcbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgICAgcmVhZGVyLnJlYWRBc0RhdGFVUkwoc2VsZWN0ZWRGaWxlKTtcbiAgICB9O1xuICB9XG4gIGNvbXBvbmVudERpZE1vdW50KCkge1xuICAgIHRoaXMuJGZpbGVDaG9vc2VyLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIHRoaXMuX2hhbmRsZUZpbGVJbnB1dENoYW5nZSk7XG4gIH1cbiAgcmVuZGVyKHt9LCB7fSwgeyBvcHRpb25zIH0pIHtcbiAgICBjb25zdCB7IGNsYXNzTmFtZSB9ID0gb3B0aW9ucztcbiAgICByZXR1cm4gKFxuICAgICAgPGRpdj5cbiAgICAgICAgPGRpdiBjbGFzcz17YCR7Y2xhc3NOYW1lfS1wcmltYXJ5Qm94YH0+XG4gICAgICAgICAgPGRpdlxuICAgICAgICAgICAgY2xhc3M9e2Ake2NsYXNzTmFtZX0tc3RlcDEtYWN0aW9uQm94YH1cbiAgICAgICAgICAgIG9uQ2xpY2s9e3RoaXMuaGFuZGxlQWN0aW9uQm94Q2xpY2t9XG4gICAgICAgICAgPlxuICAgICAgICAgICAgPGRpdiBjbGFzcz17YCR7Y2xhc3NOYW1lfS1zdGVwMS1hY3Rpb25Cb3gtY29udGVudGB9PlxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LXN0ZXAxLWFjdGlvbkJveC1jb250ZW50LXBpY1dyYXBgfT5cbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LXN0ZXAxLWFjdGlvbkJveC1jb250ZW50LXBpY2B9PlxuICAgICAgICAgICAgICAgICAgPEljb24gbmFtZT1cImFkZC1waG90b1wiIC8+XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LXN0ZXAxLWFjdGlvbkJveC1jb250ZW50LWNob29zZWB9PlxuICAgICAgICAgICAgICAgIENob29zZSBQaG90b1xuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz17YCR7Y2xhc3NOYW1lfS1zdGVwMS1hY3Rpb25Cb3gtY29udGVudC1kcmFnYH0+XG4gICAgICAgICAgICAgICAgb3IgZHJhZyBhbiBpbWFnZSBoZXJlXG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICA8aW5wdXRcbiAgICAgICAgICAgICAgICB0eXBlPVwiZmlsZVwiXG4gICAgICAgICAgICAgICAgYWNjZXB0PVwiaW1hZ2UvKlwiXG4gICAgICAgICAgICAgICAgY2xhc3M9e2Ake2NsYXNzTmFtZX0tc3RlcDEtYWN0aW9uQm94LWZpbGUtY2hvb3NlcmB9XG4gICAgICAgICAgICAgICAgcmVmPXsoJGVsKSA9PiB0aGlzLiRmaWxlQ2hvb3NlciA9ICRlbH1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPFBob3RvQm94QWN0aW9uQmFyPlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgdGV4dEFsaWduOiAnY2VudGVyJyB9fT5cbiAgICAgICAgICAgIDxQaG90b0JveEFjdGlvbkJhckxpc3Q+XG4gICAgICAgICAgICAgIDxQaG90b0JveEFjdGlvbkJhckl0ZW0gaXNTZWxlY3RlZD17dHJ1ZX0gaWNvbj1cInVwbG9hZFwiIC8+XG4gICAgICAgICAgICAgIDxQaG90b0JveEFjdGlvbkJhckl0ZW0gaXNTZWxlY3RlZD17ZmFsc2V9IGljb249XCJ0YWtlLXBpY3R1cmVcIiAvPlxuICAgICAgICAgICAgPC9QaG90b0JveEFjdGlvbkJhckxpc3Q+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvUGhvdG9Cb3hBY3Rpb25CYXI+XG4gICAgICA8L2Rpdj5cbiAgICApO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IHdpdGhDU1MoUGhvdG9Cb3hTdGVwMSwgY3NzKTtcbiIsImltcG9ydCB7IGgsIENvbXBvbmVudCwgY2xvbmVFbGVtZW50IH0gZnJvbSAncHJlYWN0JztcblxuY2xhc3MgTW91c2VNb3ZlciBleHRlbmRzIENvbXBvbmVudCB7XG4gIGNvbnN0cnVjdG9yKC4uLmFyZ3MpIHtcbiAgICBzdXBlciguLi5hcmdzKTtcblxuICAgIHRoaXMuc3RhdGUgPSB7IHg6IDAsIHk6IDAsIHByZXNzZWQ6IGZhbHNlIH07XG5cbiAgICAvLyBNZW1vaXplZCB2YWx1ZXNcbiAgICBsZXQgX3dpZHRoO1xuICAgIGxldCBfaGVpZ2h0O1xuXG4gICAgY29uc3Qgc2V0U3RhdGVGcm9tRXZlbnQgPSAoeyBlLCBwcmVzc2VkIH0pID0+IHtcbiAgICAgIGNvbnN0IHdpZHRoID0gX3dpZHRoIHx8IGUuY3VycmVudFRhcmdldC5vZmZzZXRXaWR0aDtcbiAgICAgIGNvbnN0IGhlaWdodCA9IF9oZWlnaHQgfHwgZS5jdXJyZW50VGFyZ2V0Lm9mZnNldEhlaWdodDtcbiAgICAgIGNvbnN0IHggPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIGUub2Zmc2V0WCAvIHdpZHRoKSk7XG4gICAgICBjb25zdCB5ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBlLm9mZnNldFkgLyBoZWlnaHQpKTtcbiAgICAgIHRoaXMuc2V0U3RhdGUoeyB4LCB5LCBwcmVzc2VkIH0sICgpID0+IHtcbiAgICAgICAgdGhpcy5wcm9wcy5vbkNoYW5nZSh0aGlzLnN0YXRlKTtcbiAgICAgIH0pO1xuICAgIH07XG5cbiAgICB0aGlzLmhhbmRsZUNoYW5nZSA9ICh0eXBlKSA9PiAoZSkgPT4ge1xuICAgICAgY29uc3QgeyBwcmVzc2VkIH0gPSB0aGlzLnN0YXRlO1xuICAgICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICAgIGNhc2UgJ01vdXNlRG93bic6XG4gICAgICAgICAgc2V0U3RhdGVGcm9tRXZlbnQoeyBlLCBwcmVzc2VkOiB0cnVlIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdNb3VzZVVwJzpcbiAgICAgICAgICBpZiAocHJlc3NlZCkge1xuICAgICAgICAgICAgc2V0U3RhdGVGcm9tRXZlbnQoeyBlLCBwcmVzc2VkOiBmYWxzZSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ01vdXNlTW92ZSc6XG4gICAgICAgICAgaWYgKHByZXNzZWQpIHtcbiAgICAgICAgICAgIHNldFN0YXRlRnJvbUV2ZW50KHsgZSwgcHJlc3NlZDogdHJ1ZSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ01vdXNlTGVhdmUnOlxuICAgICAgICAgIGlmIChwcmVzc2VkKSB7XG4gICAgICAgICAgICBzZXRTdGF0ZUZyb21FdmVudCh7IGUsIHByZXNzZWQ6IGZhbHNlIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgZXZlbnQgdHlwZScpO1xuICAgICAgfVxuICAgIH07XG4gIH1cbiAgcmVuZGVyKHsgY2hpbGRyZW4gfSwgeyB4LCB5LCBwcmVzc2VkIH0pIHtcbiAgICBjb25zdCBjaGlsZCA9IGNoaWxkcmVuWzBdO1xuICAgIGNvbnN0IGVsID0gdHlwZW9mIGNoaWxkID09PSAnZnVuY3Rpb24nID8gY2hpbGQoeyB4LCB5LCBwcmVzc2VkIH0pIDogY2hpbGQ7XG4gICAgcmV0dXJuIGNsb25lRWxlbWVudChlbCwge1xuICAgICAgb25Nb3VzZURvd246IHRoaXMuaGFuZGxlQ2hhbmdlKCdNb3VzZURvd24nKSxcbiAgICAgIG9uTW91c2VVcDogdGhpcy5oYW5kbGVDaGFuZ2UoJ01vdXNlVXAnKSxcbiAgICAgIG9uTW91c2VMZWF2ZTogdGhpcy5oYW5kbGVDaGFuZ2UoJ01vdXNlTGVhdmUnKSxcbiAgICAgIG9uTW91c2VNb3ZlOiB0aGlzLmhhbmRsZUNoYW5nZSgnTW91c2VNb3ZlJylcbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBNb3VzZU1vdmVyO1xuIiwiaW1wb3J0IHsgcmdiYSB9IGZyb20gJy4uLy4uL3V0aWwvY29sb3InO1xuXG5leHBvcnQgZGVmYXVsdCAoeyBjbGFzc05hbWUsIHNpemUsIHByaW1hcnlDb2xvciwgc2Vjb25kYXJ5Q29sb3IgfSwge30pID0+IChgXG4gIC4ke2NsYXNzTmFtZX0tc2xpZGVyIHtcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gICAgd2lkdGg6IDEwMCU7XG4gICAgaGVpZ2h0OiAyMHB4O1xuICAgIGN1cnNvcjogZGVmYXVsdDtcbiAgfVxuICAuJHtjbGFzc05hbWV9LXNsaWRlci13cmFwIHtcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gICAgbWFyZ2luOiAwIGF1dG87XG4gICAgd2lkdGg6IGNhbGMoMTAwJSAtIDIwcHgpO1xuICAgIGhlaWdodDogMjBweDtcbiAgICBwb2ludGVyLWV2ZW50czogbm9uZTtcbiAgfVxuICAuJHtjbGFzc05hbWV9LXNsaWRlci1oYW5kbGUge1xuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICB0b3A6IDA7XG4gICAgbGVmdDogMDtcbiAgICB3aWR0aDogMjBweDtcbiAgICBoZWlnaHQ6IDIwcHg7XG4gICAgcG9pbnRlci1ldmVudHM6IG5vbmU7XG4gICAgY3Vyc29yOiBtb3ZlO1xuICAgIGJhY2tncm91bmQtY29sb3I6ICR7cmdiYShwcmltYXJ5Q29sb3IpfTtcbiAgICBib3JkZXItcmFkaXVzOiAxMDAlO1xuICAgIGJveC1zaGFkb3c6IDAgMXB4IDNweCAke3JnYmEoc2Vjb25kYXJ5Q29sb3IsIC41KX07XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1zbGlkZXItYmFyIHtcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgdG9wOiA1MCU7XG4gICAgbWFyZ2luLXRvcDogLTJweDtcbiAgICB3aWR0aDogMTAwJTtcbiAgICBoZWlnaHQ6IDRweDtcbiAgICBib3JkZXItcmFkaXVzOiAycHg7XG4gICAgYmFja2dyb3VuZC1jb2xvcjogJHtyZ2JhKHByaW1hcnlDb2xvciwgLjUpfTtcbiAgICBib3gtc2hhZG93OiAwIDFweCA0cHggJHtyZ2JhKHNlY29uZGFyeUNvbG9yLCAuMil9O1xuICB9XG5gKTsiLCJpbXBvcnQgeyBoLCBDb21wb25lbnQgfSBmcm9tICdwcmVhY3QnO1xuaW1wb3J0IE1vdXNlTW92ZXIgZnJvbSAnLi4vTW91c2VNb3Zlcic7XG5pbXBvcnQgd2l0aENTUyBmcm9tICcuLi93aXRoQ1NTJztcbmltcG9ydCBjc3MgZnJvbSAnLi9TbGlkZXIuY3NzLmpzJztcblxuY29uc3QgU2xpZGVyID0gKHsgb25DaGFuZ2UgfSwgeyBvcHRpb25zIH0pID0+IHtcbiAgY29uc3QgeyBjbGFzc05hbWUgfSA9IG9wdGlvbnM7XG4gIHJldHVybiAoXG4gICAgPE1vdXNlTW92ZXIgb25DaGFuZ2U9eyh7IHggfSkgPT4gb25DaGFuZ2UoeCl9PlxuICAgICAgeyh7IHggfSkgPT4gKFxuICAgICAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LXNsaWRlcmB9PlxuICAgICAgICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tc2xpZGVyLXdyYXBgfT5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tc2xpZGVyLWJhcmB9PjwvZGl2PlxuICAgICAgICAgICAgPGRpdlxuICAgICAgICAgICAgICBjbGFzcz17YCR7Y2xhc3NOYW1lfS1zbGlkZXItaGFuZGxlYH1cbiAgICAgICAgICAgICAgc3R5bGU9e3sgbGVmdDogYGNhbGMoJHsoeCAqIDEwMCkudG9GaXhlZCgyKX0lIC0gMTBweClgIH19XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8L2Rpdj5cbiAgICAgICl9XG4gICAgPC9Nb3VzZU1vdmVyPlxuICApO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgd2l0aENTUyhTbGlkZXIsIGNzcyk7XG4iLCJpbXBvcnQgeyBoLCBDb21wb25lbnQsIGNsb25lRWxlbWVudCB9IGZyb20gJ3ByZWFjdCc7XG5cbmNsYXNzIE1vdXNlRHJhZ2dlciBleHRlbmRzIENvbXBvbmVudCB7XG4gIGNvbnN0cnVjdG9yKC4uLmFyZ3MpIHtcbiAgICBzdXBlciguLi5hcmdzKTtcblxuICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICB4OiAwLCB5OiAwLFxuICAgICAgZGVsdGFYOiAwLCBkZWx0YVk6IDAsXG4gICAgICBwcmVzc2VkOiBmYWxzZSxcbiAgICB9O1xuXG4gICAgbGV0IHByZXZYO1xuICAgIGxldCBwcmV2WTtcblxuICAgIGNvbnN0IHNldFN0YXRlRnJvbUV2ZW50ID0gKHsgZSwgcHJlc3NlZCB9KSA9PiB7XG4gICAgICBjb25zdCB4ID0gZS5vZmZzZXRYO1xuICAgICAgY29uc3QgeSA9IGUub2Zmc2V0WTtcbiAgICAgIGNvbnN0IGRlbHRhWCA9IHggLSAocHJldlggfHwgeCk7XG4gICAgICBjb25zdCBkZWx0YVkgPSB5IC0gKHByZXZZIHx8IHkpO1xuXG4gICAgICBwcmV2WCA9IHByZXNzZWQgPyB4IDogbnVsbDtcbiAgICAgIHByZXZZID0gcHJlc3NlZCA/IHkgOiBudWxsO1xuXG4gICAgICB0aGlzLnNldFN0YXRlKHsgeCwgeSwgZGVsdGFYLCBkZWx0YVksIHByZXNzZWQgfSwgKCkgPT4ge1xuICAgICAgICB0aGlzLnByb3BzLm9uQ2hhbmdlKHRoaXMuc3RhdGUpO1xuICAgICAgfSk7XG4gICAgfTtcblxuICAgIHRoaXMuaGFuZGxlQ2hhbmdlID0gKHR5cGUpID0+IChlKSA9PiB7XG4gICAgICBjb25zdCB7IHByZXNzZWQgfSA9IHRoaXMuc3RhdGU7XG4gICAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgICAgY2FzZSAnTW91c2VEb3duJzpcbiAgICAgICAgICBzZXRTdGF0ZUZyb21FdmVudCh7IGUsIHByZXNzZWQ6IHRydWUgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ01vdXNlVXAnOlxuICAgICAgICAgIGlmIChwcmVzc2VkKSB7XG4gICAgICAgICAgICBzZXRTdGF0ZUZyb21FdmVudCh7IGUsIHByZXNzZWQ6IGZhbHNlIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnTW91c2VNb3ZlJzpcbiAgICAgICAgICBpZiAocHJlc3NlZCkge1xuICAgICAgICAgICAgc2V0U3RhdGVGcm9tRXZlbnQoeyBlLCBwcmVzc2VkOiB0cnVlIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnTW91c2VMZWF2ZSc6XG4gICAgICAgICAgaWYgKHByZXNzZWQpIHtcbiAgICAgICAgICAgIHNldFN0YXRlRnJvbUV2ZW50KHsgZSwgcHJlc3NlZDogZmFsc2UgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBldmVudCB0eXBlJyk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxuICByZW5kZXIoeyBjaGlsZHJlbiB9LCB7IHgsIHksIGRlbHRhWCwgZGVsdGFZIH0pIHtcbiAgICBjb25zdCBjaGlsZCA9IGNoaWxkcmVuWzBdO1xuICAgIGNvbnN0IGVsID0gKFxuICAgICAgdHlwZW9mIGNoaWxkID09PSAnZnVuY3Rpb24nXG4gICAgICA/IGNoaWxkKHsgeCwgeSwgZGVsdGFYLCBkZWx0YVkgfSlcbiAgICAgIDogY2hpbGRcbiAgICApO1xuICAgIHJldHVybiBjbG9uZUVsZW1lbnQoZWwsIHtcbiAgICAgIG9uTW91c2VEb3duOiB0aGlzLmhhbmRsZUNoYW5nZSgnTW91c2VEb3duJyksXG4gICAgICBvbk1vdXNlVXA6IHRoaXMuaGFuZGxlQ2hhbmdlKCdNb3VzZVVwJyksXG4gICAgICBvbk1vdXNlTGVhdmU6IHRoaXMuaGFuZGxlQ2hhbmdlKCdNb3VzZUxlYXZlJyksXG4gICAgICBvbk1vdXNlTW92ZTogdGhpcy5oYW5kbGVDaGFuZ2UoJ01vdXNlTW92ZScpXG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgTW91c2VEcmFnZ2VyO1xuIiwiaW1wb3J0IHsgcmdiYSB9IGZyb20gJy4uLy4uL3V0aWwvY29sb3InO1xuXG5leHBvcnQgZGVmYXVsdCAoeyBjbGFzc05hbWUsIHNpemUsIHByaW1hcnlDb2xvciwgc2Vjb25kYXJ5Q29sb3IgfSwge30pID0+IChgXG4gIC4ke2NsYXNzTmFtZX0tc3RlcDItYWN0aW9uQm94IHtcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gICAgd2lkdGg6ICR7c2l6ZX1weDtcbiAgICBoZWlnaHQ6ICR7c2l6ZX1weDtcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XG4gICAgY3Vyc29yOiBtb3ZlO1xuICAgIGJvcmRlcjogMnB4IHNvbGlkICR7cmdiYShwcmltYXJ5Q29sb3IpfTtcbiAgfVxuICAuJHtjbGFzc05hbWV9LXN0ZXAyLWNhbnZhcyB7XG4gICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgIHRvcDogMDtcbiAgICBsZWZ0OiAwO1xuICAgIHdpZHRoOiAxMDAlO1xuICAgIGhlaWdodDogMTAwJTtcbiAgfVxuICAuJHtjbGFzc05hbWV9LXN0ZXAyLWZyYW1lIHtcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgdG9wOiAwO1xuICAgIGxlZnQ6IDA7XG4gICAgd2lkdGg6IDEwMCU7XG4gICAgaGVpZ2h0OiAxMDAlO1xuICAgIGJvcmRlcjogMTBweCBzb2xpZCAke3JnYmEoc2Vjb25kYXJ5Q29sb3IsIC41KX07XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1zdGVwMi1zbGlkZXIge1xuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICBib3R0b206IDIycHg7XG4gICAgbGVmdDogMjJweDtcbiAgICByaWdodDogMjJweDtcbiAgICBvcGFjaXR5OiAwO1xuICAgIHRyYW5zaXRpb246IG9wYWNpdHkgLjJzIGVhc2UtaW4tb3V0O1xuICB9XG4gIC4ke2NsYXNzTmFtZX06aG92ZXIgLiR7Y2xhc3NOYW1lfS1wcmltYXJ5Qm94Om5vdCguaXMtZHJhZ2dpbmcpIC4ke2NsYXNzTmFtZX0tc3RlcDItc2xpZGVyIHtcbiAgICBvcGFjaXR5OiAxO1xuICB9XG5gKTsiLCJpbXBvcnQgeyBoLCBDb21wb25lbnQgfSBmcm9tICdwcmVhY3QnO1xuaW1wb3J0IEljb24gZnJvbSAnLi4vSWNvbic7XG5pbXBvcnQge1xuICBQaG90b0JveEFjdGlvbkJhcixcbiAgUGhvdG9Cb3hBY3Rpb25CYXJMaXN0LFxuICBQaG90b0JveEFjdGlvbkJhckl0ZW1cbn0gZnJvbSAnLi4vUGhvdG9Cb3hBY3Rpb25CYXIvUGhvdG9Cb3hBY3Rpb25CYXInO1xuaW1wb3J0IFNsaWRlciBmcm9tICcuLi9TbGlkZXIvU2xpZGVyJztcbmltcG9ydCB7IGNsYXNzbmFtZXMgfSBmcm9tICcuLi8uLi91dGlsL2NsYXNzbmFtZXMnO1xuaW1wb3J0IE1vdXNlRHJhZ2dlciBmcm9tICcuLi9Nb3VzZURyYWdnZXInO1xuaW1wb3J0IHdpdGhDU1MgZnJvbSAnLi4vd2l0aENTUyc7XG5pbXBvcnQgY3NzIGZyb20gJy4vUGhvdG9Cb3hTdGVwMi5jc3MuanMnO1xuaW1wb3J0IHsgZGF0YVVybFRvQmxvYiwgZGF0YVVybFRvQmxvYjIgfSBmcm9tICcuLi8uLi91dGlsL2Jsb2InO1xuXG5jbGFzcyBQaG90b0JveFN0ZXAyIGV4dGVuZHMgQ29tcG9uZW50IHtcbiAgY29uc3RydWN0b3IoLi4uYXJncykge1xuICAgIHN1cGVyKC4uLmFyZ3MpO1xuICAgIGNvbnN0IGZyYW1lU2l6ZSA9IHRoaXMuY29udGV4dC5vcHRpb25zLnNpemU7XG4gICAgdGhpcy5zdGF0ZSA9IHtcbiAgICAgIGltYWdlU2l6ZTogZnJhbWVTaXplLFxuICAgICAgaW1hZ2VYOiAxMCxcbiAgICAgIGltYWdlWTogMTAsXG4gICAgICBkcmFnZ2luZzogZmFsc2UsXG4gICAgfTtcblxuICAgIHRoaXMuaGFuZGxlU2F2ZUNsaWNrID0gKCkgPT4ge1xuICAgICAgY29uc3QgeyBzZWxlY3RlZEZpbGUsIHByb2Nlc3NGaWxlIH0gPSB0aGlzLnByb3BzO1xuXG4gICAgICBjb25zdCBuZXdDYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICAgIGNvbnN0IG5ld0NvbnRleHQgPSBuZXdDYW52YXMuZ2V0Q29udGV4dCgnMmQnKTtcblxuICAgICAgbmV3Q2FudmFzLndpZHRoID0gZnJhbWVTaXplO1xuICAgICAgbmV3Q2FudmFzLmhlaWdodCA9IGZyYW1lU2l6ZTtcblxuICAgICAgbmV3Q29udGV4dC5kcmF3SW1hZ2UodGhpcy5jYW52YXMsIC0xMCwgLTEwKTtcblxuICAgICAgY29uc3QgYmFzZTY0RGF0YSA9IG5ld0NhbnZhcy50b0RhdGFVUkwoXCJpbWFnZS9qcGVnXCIpO1xuICAgICAgY29uc3QgYmxvYiA9IGRhdGFVcmxUb0Jsb2IoYmFzZTY0RGF0YSk7XG5cbiAgICAgIHByb2Nlc3NGaWxlKHtcbiAgICAgICAgbmFtZTogc2VsZWN0ZWRGaWxlLm5hbWUsXG4gICAgICAgIHNpemU6IGJsb2Iuc2l6ZSxcbiAgICAgICAgdHlwZTogYmxvYi50eXBlLFxuICAgICAgICBiYXNlNjQ6IGJhc2U2NERhdGEsXG4gICAgICAgIGJsb2I6IGJsb2IsXG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgdGhpcy5vblNsaWRlckNoYW5nZSA9IChwZXJjZW50KSA9PiB7XG4gICAgICBjb25zdCBjaGFuZ2VzID0ge307XG4gICAgICBjb25zdCBuZXdJbWFnZVNpemUgPSBmcmFtZVNpemUgKiAoMS4wICsgcGVyY2VudCk7XG5cbiAgICAgIGNvbnN0IHsgaW1hZ2VYLCBpbWFnZVkgfSA9IHRoaXMuc3RhdGU7XG4gICAgICBpZiAoKGltYWdlWCArIG5ld0ltYWdlU2l6ZSkgPCAoZnJhbWVTaXplICsgMTApKSB7XG4gICAgICAgIGNoYW5nZXMuaW1hZ2VYID0gKGZyYW1lU2l6ZSArIDEwKSAtIG5ld0ltYWdlU2l6ZTtcbiAgICAgIH1cbiAgICAgIGlmICgoaW1hZ2VZICsgbmV3SW1hZ2VTaXplKSA8IChmcmFtZVNpemUgKyAxMCkpIHtcbiAgICAgICAgY2hhbmdlcy5pbWFnZVkgPSAoZnJhbWVTaXplICsgMTApIC0gbmV3SW1hZ2VTaXplO1xuICAgICAgfVxuXG4gICAgICBjaGFuZ2VzLmltYWdlU2l6ZSA9IG5ld0ltYWdlU2l6ZTtcbiAgICAgIHRoaXMuc2V0U3RhdGUoY2hhbmdlcyk7XG4gICAgfTtcblxuICAgIHRoaXMuaGFuZGxlTW91c2VEcmFnZ2VyQ2hhbmdlID0gKHsgZGVsdGFYLCBkZWx0YVksIHByZXNzZWQgfSkgPT4ge1xuICAgICAgY29uc3QgeyBpbWFnZVgsIGltYWdlWSwgaW1hZ2VTaXplIH0gPSB0aGlzLnN0YXRlO1xuXG4gICAgICBsZXQgbmV3SW1hZ2VYID0gTWF0aC5taW4oMTAsIGltYWdlWCArIGRlbHRhWCk7XG4gICAgICBsZXQgbmV3SW1hZ2VZID0gTWF0aC5taW4oMTAsIGltYWdlWSArIGRlbHRhWSk7XG5cbiAgICAgIGlmICgobmV3SW1hZ2VYICsgaW1hZ2VTaXplKSA8IChmcmFtZVNpemUgKyAxMCkpIHtcbiAgICAgICAgbmV3SW1hZ2VYID0gKGZyYW1lU2l6ZSArIDEwKSAtIGltYWdlU2l6ZTtcbiAgICAgIH1cbiAgICAgIGlmICgobmV3SW1hZ2VZICsgaW1hZ2VTaXplKSA8IChmcmFtZVNpemUgKyAxMCkpIHtcbiAgICAgICAgbmV3SW1hZ2VZID0gKGZyYW1lU2l6ZSArIDEwKSAtIGltYWdlU2l6ZTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5zZXRTdGF0ZSh7XG4gICAgICAgIGltYWdlWDogbmV3SW1hZ2VYLFxuICAgICAgICBpbWFnZVk6IG5ld0ltYWdlWSxcbiAgICAgICAgZHJhZ2dpbmc6IHByZXNzZWQsXG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgdGhpcy5fZHJhd0ltYWdlID0gKGltZ0RhdGFBc0Jhc2U2NCkgPT4ge1xuICAgICAgY29uc3QgeyBzaXplIH0gPSB0aGlzLmNvbnRleHQub3B0aW9ucztcbiAgICAgIGNvbnN0IHsgaW1hZ2VTaXplLCBpbWFnZVgsIGltYWdlWSB9ID0gdGhpcy5zdGF0ZTtcbiAgICAgIC8vIGNvbnN0IG9mZnNldCA9IChpbWFnZVNpemUgLSAoc2l6ZSArICgxMCAqIDIpKSkgLyAtMjtcbiAgICAgIGNvbnN0IGltZyA9IG5ldyBJbWFnZSgpO1xuICAgICAgaW1nLm9ubG9hZCA9ICgpID0+IHtcbiAgICAgICAgY29uc3QgY29udGV4dCA9IHRoaXMuY2FudmFzLmdldENvbnRleHQoJzJkJyk7XG4gICAgICAgIGNvbnRleHQuY2xlYXJSZWN0KDAsIDAsIHRoaXMuY2FudmFzLndpZHRoLCB0aGlzLmNhbnZhcy5oZWlnaHQpO1xuICAgICAgICBjb250ZXh0LmRyYXdJbWFnZShpbWcsIGltYWdlWCwgaW1hZ2VZLCBpbWFnZVNpemUsIGltYWdlU2l6ZSk7XG4gICAgICB9O1xuICAgICAgaW1nLnNyYyA9IGltZ0RhdGFBc0Jhc2U2NDtcbiAgICB9O1xuICB9XG4gIGNvbXBvbmVudERpZE1vdW50KCkge1xuICAgIGNvbnN0IHsgc2VsZWN0ZWRGaWxlIH0gPSB0aGlzLnByb3BzO1xuICAgIGNvbnN0IHsgaW1hZ2VTaXplIH0gPSB0aGlzLnN0YXRlO1xuICAgIGNvbnN0IHsgb3B0aW9ucyB9ID0gdGhpcy5jb250ZXh0O1xuXG4gICAgLy8gVE9ETzogTWFnaWMgbnVtYmVyIChwYWRkaW5nKVxuICAgIGNvbnN0IGNhbnZhc1NpemUgPSBpbWFnZVNpemUgKyAoMTAgKiAyKTtcbiAgICBjb25zdCBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICB0aGlzLmNhbnZhcyA9IGNhbnZhcztcbiAgICBjYW52YXMud2lkdGggPWNhbnZhc1NpemU7XG4gICAgY2FudmFzLmhlaWdodCA9IGNhbnZhc1NpemU7XG4gICAgdGhpcy4kcHJldmlldy5hcHBlbmRDaGlsZChjYW52YXMpO1xuXG4gICAgdGhpcy5kcmF3SW1hZ2UgPSAoKSA9PiB0aGlzLl9kcmF3SW1hZ2Uoc2VsZWN0ZWRGaWxlLmJhc2U2NCk7XG4gICAgdGhpcy5kcmF3SW1hZ2UoKTtcbiAgfVxuICBjb21wb25lbnREaWRVcGRhdGUocHJldlByb3BzLCBwcmV2U3RhdGUpIHtcbiAgICBpZiAoXG4gICAgICAodGhpcy5zdGF0ZS5pbWFnZVNpemUgIT09IHByZXZTdGF0ZS5pbWFnZVNpemUpIHx8XG4gICAgICAodGhpcy5zdGF0ZS5pbWFnZVggIT09IHByZXZTdGF0ZS5pbWFnZVgpIHx8XG4gICAgICAodGhpcy5zdGF0ZS5pbWFnZVkgIT09IHByZXZTdGF0ZS5pbWFnZVkpXG4gICAgKSB7XG4gICAgICB0aGlzLmRyYXdJbWFnZSgpO1xuICAgIH1cbiAgfVxuICByZW5kZXIoe30sIHsgZHJhZ2dpbmcgfSwgeyBvcHRpb25zIH0pIHtcbiAgICBjb25zdCB7IGNsYXNzTmFtZSB9ID0gb3B0aW9ucztcbiAgICByZXR1cm4gKFxuICAgICAgPGRpdj5cbiAgICAgICAgPGRpdiBjbGFzcz17Y2xhc3NuYW1lcyh7XG4gICAgICAgICAgW2Ake2NsYXNzTmFtZX0tcHJpbWFyeUJveGBdOiB0cnVlLFxuICAgICAgICAgICdpcy1kcmFnZ2luZyc6IGRyYWdnaW5nLFxuICAgICAgICB9KX0+XG4gICAgICAgICAgPGRpdlxuICAgICAgICAgICAgY2xhc3M9e2Ake2NsYXNzTmFtZX0tc3RlcDItY2FudmFzYH1cbiAgICAgICAgICAgIHJlZj17KCRlbCkgPT4gdGhpcy4kcHJldmlldyA9ICRlbH1cbiAgICAgICAgICAvPlxuICAgICAgICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tc3RlcDItZnJhbWVgfSAvPlxuICAgICAgICAgIDxNb3VzZURyYWdnZXIgb25DaGFuZ2U9e3RoaXMuaGFuZGxlTW91c2VEcmFnZ2VyQ2hhbmdlfT5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tc3RlcDItYWN0aW9uQm94YH0gLz5cbiAgICAgICAgICA8L01vdXNlRHJhZ2dlcj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LXN0ZXAyLXNsaWRlcmB9PlxuICAgICAgICAgICAgPFNsaWRlciBvbkNoYW5nZT17dGhpcy5vblNsaWRlckNoYW5nZX0gLz5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxQaG90b0JveEFjdGlvbkJhcj5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6ICdmbGV4JywganVzdGlmeUNvbnRlbnQ6ICdzcGFjZS1iZXR3ZWVuJyB9fT5cbiAgICAgICAgICAgIDxQaG90b0JveEFjdGlvbkJhckxpc3Q+XG4gICAgICAgICAgICAgIDxQaG90b0JveEFjdGlvbkJhckl0ZW0gaXNTZWxlY3RlZD17dHJ1ZX0gaWNvbj1cImNyb3BcIiAvPlxuICAgICAgICAgICAgICA8UGhvdG9Cb3hBY3Rpb25CYXJJdGVtIGlzU2VsZWN0ZWQ9e2ZhbHNlfSBpY29uPVwiZmlsdGVyc1wiIC8+XG4gICAgICAgICAgICA8L1Bob3RvQm94QWN0aW9uQmFyTGlzdD5cbiAgICAgICAgICAgIDxQaG90b0JveEFjdGlvbkJhckxpc3Q+XG4gICAgICAgICAgICAgIDxQaG90b0JveEFjdGlvbkJhckl0ZW1cbiAgICAgICAgICAgICAgICBpc0VtcGhhc2l6ZWQ9e3RydWV9XG4gICAgICAgICAgICAgICAgaWNvbj1cImNoZWNrXCJcbiAgICAgICAgICAgICAgICBvblByZXNzPXt0aGlzLmhhbmRsZVNhdmVDbGlja31cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvUGhvdG9Cb3hBY3Rpb25CYXJMaXN0PlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8L1Bob3RvQm94QWN0aW9uQmFyPlxuICAgICAgPC9kaXY+XG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCB3aXRoQ1NTKFBob3RvQm94U3RlcDIsIGNzcyk7XG4iLCJpbXBvcnQgeyByZ2JhIH0gZnJvbSAnLi4vLi4vdXRpbC9jb2xvcic7XG5cbmV4cG9ydCBkZWZhdWx0ICh7IGNsYXNzTmFtZSwgc2l6ZSwgcHJpbWFyeUNvbG9yLCBzZWNvbmRhcnlDb2xvciB9LCB7fSkgPT4gKGBcbiAgLiR7Y2xhc3NOYW1lfS1zdGVwMyB7XG4gICAgcG9zaXRpb246IHJlbGF0aXZlO1xuICAgIHdpZHRoOiAke3NpemV9cHg7XG4gICAgaGVpZ2h0OiAke3NpemV9cHg7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1zdGVwMy11cGxvYWRCYXIge1xuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICBsZWZ0OiAwO1xuICAgIHRvcDogMDtcbiAgICBoZWlnaHQ6ICR7c2l6ZX1weDtcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiAke3JnYmEoc2Vjb25kYXJ5Q29sb3IsIC43NSl9O1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tc3RlcDMtdXBsb2FkVGV4dCB7XG4gICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgIGxlZnQ6IDA7XG4gICAgdG9wOiA1MCU7XG4gICAgdHJhbnNmb3JtOiB0cmFuc2xhdGVZKC01MCUpO1xuICAgIHdpZHRoOiAxMDAlO1xuICAgIGZvbnQtc2l6ZTogMTAwJTtcbiAgICBmb250LXdlaWdodDogYm9sZDtcbiAgICBsZXR0ZXItc3BhY2luZzogNHB4O1xuICAgIGNvbG9yOiAke3JnYmEocHJpbWFyeUNvbG9yKX07XG4gICAgdGV4dC1zaGFkb3c6IDAgMXB4IDRweCAke3JnYmEoc2Vjb25kYXJ5Q29sb3IsIC41KX07XG4gICAgdGV4dC1hbGlnbjogY2VudGVyO1xuICAgIHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7XG4gIH1cbmApOyIsImV4cG9ydCBjb25zdCBzZW5kRmlsZSA9ICh7IHVybCwgZmlsZSwgb25Qcm9ncmVzcywgb25Db21wbGV0ZSB9KSA9PiB7XG4gIGxldCBkYXRhID0gbmV3IEZvcm1EYXRhKCk7XG4gIGRhdGEuYXBwZW5kKCdhdmF0YXInLCBmaWxlLmJsb2IsIGZpbGUubmFtZSk7XG5cbiAgY29uc3QgeGhyID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG4gIHhoci51cGxvYWQuYWRkRXZlbnRMaXN0ZW5lcigncHJvZ3Jlc3MnLCAoZXZ0KSA9PiB7XG4gICAgaWYgKGV2dC5sZW5ndGhDb21wdXRhYmxlKSB7XG4gICAgICBjb25zdCB7IGxvYWRlZCwgdG90YWwgfSA9IGV2dDtcbiAgICAgIGNvbnN0IHBlcmNlbnQgPSBsb2FkZWQgLyB0b3RhbDtcbiAgICAgIG9uUHJvZ3Jlc3MoeyBwZXJjZW50LCBsb2FkZWQsIHRvdGFsIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLndhcm4oJ0xlbmd0aCBub3QgY29tcHV0YWJsZSBmcm9tIHRoZSBzZXJ2ZXIuJyk7XG4gICAgfVxuICB9LCBmYWxzZSk7XG4gIHhoci51cGxvYWQuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIChlKSA9PiB7XG4gICAgY29uc29sZS5sb2coJ3VwbG9hZCBkb25lJyk7XG4gICAgb25Db21wbGV0ZSh7IGUsIHN0YXR1czogeGhyLnN0YXR1cyB9KTtcbiAgfSk7XG4gIHhoci51cGxvYWQuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCAoKSA9PiB7XG4gICAgY29uc29sZS5sb2coJ3VwbG9hZCBmYWlsZWQnKTtcbiAgfSk7XG4gIHhoci51cGxvYWQuYWRkRXZlbnRMaXN0ZW5lcignYWJvcnQnLCAoKSA9PiB7XG4gICAgY29uc29sZS5sb2coJ3VwbG9hZCBhYm9ydGVkJyk7XG4gIH0pO1xuXG4gIHhoci5vcGVuKCdQT1NUJywgdXJsLCB0cnVlKTtcbiAgeGhyLnNlbmQoZGF0YSk7XG59O1xuIiwiaW1wb3J0IHsgaCwgQ29tcG9uZW50IH0gZnJvbSAncHJlYWN0JztcbmltcG9ydCB3aXRoQ1NTIGZyb20gJy4uL3dpdGhDU1MnO1xuaW1wb3J0IGNzcyBmcm9tICcuL1Bob3RvQm94U3RlcDMuY3NzLmpzJztcbmltcG9ydCB7IHNlbmRGaWxlIH0gZnJvbSAnLi4vLi4vdXRpbC94aHInO1xuXG5jbGFzcyBQaG90b0JveFN0ZXAzIGV4dGVuZHMgQ29tcG9uZW50IHtcbiAgY29uc3RydWN0b3IoLi4uYXJncykge1xuICAgIHN1cGVyKC4uLmFyZ3MpO1xuICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICBwcm9ncmVzczogMCxcbiAgICB9O1xuICB9XG4gIGNvbXBvbmVudERpZE1vdW50KCkge1xuICAgIGNvbnN0IHsgcHJvY2Vzc2VkRmlsZSB9ID0gdGhpcy5wcm9wcztcbiAgICBjb25zb2xlLmxvZygndXBsb2FkaW5nIHByb2Nlc3NlZCBmaWxlJywgcHJvY2Vzc2VkRmlsZSk7XG4gICAgc2VuZEZpbGUoe1xuICAgICAgdXJsOiAnaHR0cDovL2xvY2FsaG9zdDo5MDAxL3VwbG9hZCcsXG4gICAgICBmaWxlOiBwcm9jZXNzZWRGaWxlLFxuICAgICAgb25Qcm9ncmVzczogKHsgcGVyY2VudCwgbG9hZGVkLCB0b3RhbCB9KSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKCd1cGxvYWQgcHJvZ3Jlc3MnLCBwZXJjZW50LCBsb2FkZWQsIHRvdGFsKTtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7IHByb2dyZXNzOiBwZXJjZW50IH0pO1xuICAgICAgfSxcbiAgICAgIG9uQ29tcGxldGU6ICh7IGUsIHN0YXR1cyB9KSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdkb25lJywgc3RhdHVzKTtcbiAgICAgICAgdGhpcy5zZXRTdGF0ZSh7IHByb2dyZXNzOiAxIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG4gIHJlbmRlcih7IHByb2Nlc3NlZEZpbGUgfSwgeyBwcm9ncmVzcyB9LCB7IG9wdGlvbnMgfSkge1xuICAgIGNvbnN0IHsgY2xhc3NOYW1lIH0gPSBvcHRpb25zO1xuICAgIHJldHVybiAoXG4gICAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LXN0ZXAzYH0+XG4gICAgICAgIDxpbWcgc3JjPXtwcm9jZXNzZWRGaWxlLmJhc2U2NH0gLz5cbiAgICAgICAgPGRpdlxuICAgICAgICAgIGNsYXNzPXtgJHtjbGFzc05hbWV9LXN0ZXAzLXVwbG9hZEJhcmB9XG4gICAgICAgICAgc3R5bGU9e3sgd2lkdGg6IGAke3Byb2dyZXNzICogMTAwfSVgIH19XG4gICAgICAgIC8+XG4gICAgICAgIDxkaXYgY2xhc3M9e2Ake2NsYXNzTmFtZX0tc3RlcDMtdXBsb2FkVGV4dGB9PlxuICAgICAgICAgIHtwcm9ncmVzcyA9PT0gMSA/ICdVcGxvYWRlZCcgOiAnVXBsb2FkaW5nJ31cbiAgICAgICAgPC9kaXY+XG4gICAgICA8L2Rpdj5cbiAgICApO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IHdpdGhDU1MoUGhvdG9Cb3hTdGVwMywgY3NzKTtcbiIsImltcG9ydCB7IHJnYmEgfSBmcm9tICcuLi8uLi91dGlsL2NvbG9yJztcblxuZXhwb3J0IGRlZmF1bHQgKHsgY2xhc3NOYW1lLCBzaXplLCBwcmltYXJ5Q29sb3IsIHNlY29uZGFyeUNvbG9yIH0sIHt9KSA9PiAoYFxuICAuJHtjbGFzc05hbWV9LXByb2dyZXNzIHtcbiAgICBwYWRkaW5nOiAxMHB4O1xuICAgIHRleHQtYWxpZ246IGNlbnRlcjtcbiAgICBib3JkZXItdG9wOiAycHggc29saWQgJHtyZ2JhKHNlY29uZGFyeUNvbG9yLCAuMSl9O1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tcHJvZ3Jlc3NMaXN0IHtcbiAgICBsaXN0LXN0eWxlLXR5cGU6IG5vbmU7XG4gICAgbWFyZ2luOiAwO1xuICAgIGZvbnQtc2l6ZTogMDtcbiAgICBwYWRkaW5nLWxlZnQ6IDA7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1wcm9ncmVzc0xpc3QtaXRlbSB7XG4gICAgZGlzcGxheTogaW5saW5lLWJsb2NrO1xuICAgIHdpZHRoOiA2cHg7XG4gICAgaGVpZ2h0OiA2cHg7XG4gICAgYm9yZGVyLXJhZGl1czogMTAwJTtcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiAke3JnYmEoc2Vjb25kYXJ5Q29sb3IsIC4yNSl9O1xuICB9XG4gIC4ke2NsYXNzTmFtZX0tcHJvZ3Jlc3NMaXN0LWl0ZW06bm90KDpsYXN0LWNoaWxkKSB7XG4gICAgbWFyZ2luLXJpZ2h0OiA0cHg7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1wcm9ncmVzc0xpc3QtaXRlbS5pcy1zZWxlY3RlZCB7XG4gICAgYmFja2dyb3VuZC1jb2xvcjogJHtyZ2JhKHNlY29uZGFyeUNvbG9yKX07XG4gIH1cbmApOyIsImltcG9ydCB7IGggfSBmcm9tICdwcmVhY3QnO1xuaW1wb3J0IGNzcyBmcm9tICcuL1Bob3RvQm94UHJvZ3Jlc3MuY3NzLmpzJztcbmltcG9ydCB3aXRoQ1NTIGZyb20gJy4uL3dpdGhDU1MnO1xuXG5jb25zdCBQaG90b0JveFByb2dyZXNzID0gKHsgc3RlcCB9LCB7IG9wdGlvbnMgfSkgPT4ge1xuICBjb25zdCB7IGNsYXNzTmFtZSB9ID0gb3B0aW9ucztcbiAgcmV0dXJuIChcbiAgICA8ZGl2IGNsYXNzPXtgJHtjbGFzc05hbWV9LXByb2dyZXNzYH0+XG4gICAgICA8dWwgY2xhc3M9e2Ake2NsYXNzTmFtZX0tcHJvZ3Jlc3NMaXN0YH0+XG4gICAgICAgIHtbMSwgMl0ubWFwKChpKSA9PiB7XG4gICAgICAgICAgY29uc3QgY2xhc3NlcyA9IFtgJHtjbGFzc05hbWV9LXByb2dyZXNzTGlzdC1pdGVtYF07XG4gICAgICAgICAgaWYgKGkgPT09IHN0ZXApIHtcbiAgICAgICAgICAgIGNsYXNzZXMucHVzaCgnaXMtc2VsZWN0ZWQnKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuICg8bGkgY2xhc3M9e2NsYXNzZXMuam9pbignICcpfT48L2xpPik7XG4gICAgICAgIH0pfVxuICAgICAgPC91bD5cbiAgICA8L2Rpdj5cbiAgKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IHdpdGhDU1MoUGhvdG9Cb3hQcm9ncmVzcywgY3NzKTtcbiIsImltcG9ydCB7IHJnYmEgfSBmcm9tICcuLi8uLi91dGlsL2NvbG9yJztcblxuZXhwb3J0IGRlZmF1bHQgKHsgY2xhc3NOYW1lLCBzaXplLCBwcmltYXJ5Q29sb3IsIHNlY29uZGFyeUNvbG9yIH0sIHt9KSA9PiAoYFxuICAuJHtjbGFzc05hbWV9Q29udGFpbmVyIHtcbiAgICBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XG4gICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgIG9wYWNpdHk6IDA7XG4gICAgZm9udC1mYW1pbHk6IGluaGVyaXQ7XG4gICAgYmFja2dyb3VuZC1jb2xvcjogJHtyZ2JhKHByaW1hcnlDb2xvcil9O1xuICAgIGJvcmRlcjogMXB4IHNvbGlkICR7cmdiYShzZWNvbmRhcnlDb2xvciwgLjI1KX07XG4gICAgYm9yZGVyLXJhZGl1czogM3B4O1xuICAgIGJveC1zaGFkb3c6IDAgMnB4IDIwcHggcmdiYSgwLDAsMCwgLjE1KTtcbiAgICB0cmFuc2l0aW9uOiBvcGFjaXR5IC4ycyBlYXNlLWluLW91dDtcbiAgICAtd2Via2l0LXVzZXItc2VsZWN0OiBub25lO1xuICAgICAgIC1tb3otdXNlci1zZWxlY3Q6IG5vbmU7XG4gICAgICAgICAgICB1c2VyLXNlbGVjdDogbm9uZTtcbiAgfVxuICAuJHtjbGFzc05hbWV9IHtcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1hbmNob3Ige1xuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jaztcbiAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgYm90dG9tOiAxMDAlO1xuICAgIGJvdHRvbTogY2FsYygxMDAlICsgMXB4KTtcbiAgICBsZWZ0OiA1MCU7XG4gICAgdHJhbnNmb3JtOiB0cmFuc2xhdGVYKC01MCUpO1xuICAgIHdpZHRoOiAwO1xuICAgIGhlaWdodDogMDtcbiAgICBib3JkZXItY29sb3I6IHRyYW5zcGFyZW50O1xuICAgIGJvcmRlci1ib3R0b20tY29sb3I6ICR7cmdiYShzZWNvbmRhcnlDb2xvciwgLjI1KX07XG4gICAgYm9yZGVyLXN0eWxlOiBzb2xpZDtcbiAgICBib3JkZXItd2lkdGg6IDAgNnB4IDZweCA2cHg7XG4gIH1cbiAgLiR7Y2xhc3NOYW1lfS1wcmltYXJ5Qm94IHtcbiAgICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gICAgcGFkZGluZzogMTBweDtcbiAgICBiYWNrZ3JvdW5kLWNvbG9yOiAke3JnYmEoc2Vjb25kYXJ5Q29sb3IsIC4xKX07XG4gIH1cbmApOyIsImltcG9ydCB7IGgsIENvbXBvbmVudCB9IGZyb20gJ3ByZWFjdCc7XG5cbmltcG9ydCBTVkdTeW1ib2xzIGZyb20gJy4uL1NWR1N5bWJvbHMnO1xuaW1wb3J0IFBob3RvQm94U3RlcDEgZnJvbSAnLi4vUGhvdG9Cb3hTdGVwMS9QaG90b0JveFN0ZXAxJztcbmltcG9ydCBQaG90b0JveFN0ZXAyIGZyb20gJy4uL1Bob3RvQm94U3RlcDIvUGhvdG9Cb3hTdGVwMic7XG5pbXBvcnQgUGhvdG9Cb3hTdGVwMyBmcm9tICcuLi9QaG90b0JveFN0ZXAzL1Bob3RvQm94U3RlcDMnO1xuaW1wb3J0IFBob3RvQm94UHJvZ3Jlc3MgZnJvbSAnLi4vUGhvdG9Cb3hQcm9ncmVzcy9QaG90b0JveFByb2dyZXNzJztcbmltcG9ydCB3aXRoQ1NTIGZyb20gJy4uL3dpdGhDU1MnO1xuaW1wb3J0IGNzcyBmcm9tICcuL1Bob3RvQm94LmNzcy5qcyc7XG5cbmNsYXNzIFBob3RvQm94IGV4dGVuZHMgQ29tcG9uZW50IHtcbiAgY29uc3RydWN0b3IoLi4uYXJncykge1xuICAgIHN1cGVyKC4uLmFyZ3MpO1xuICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICBzdGVwOiAxLFxuICAgICAgc2VsZWN0ZWRGaWxlOiBudWxsLFxuICAgICAgcHJvY2Vzc2VkRmlsZTogbnVsbCxcbiAgICB9O1xuICAgIHRoaXMuc2VsZWN0RmlsZSA9IChmaWxlKSA9PiB7XG4gICAgICB0aGlzLnNldFN0YXRlKHsgc2VsZWN0ZWRGaWxlOiBmaWxlLCBzdGVwOiAyIH0pO1xuICAgIH07XG4gICAgdGhpcy5wcm9jZXNzRmlsZSA9IChmaWxlKSA9PiB7XG4gICAgICB0aGlzLnNldFN0YXRlKHsgcHJvY2Vzc2VkRmlsZTogZmlsZSwgc3RlcDogMyB9LCAoKSA9PiB7XG4gICAgICAgIHRoaXMucHJvcHMuZXZlbnRzLmZpcmUoJ3Bvc2l0aW9uOnRhcmdldCcpO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfVxuICBnZXRDaGlsZENvbnRleHQoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9wdGlvbnM6IHRoaXMucHJvcHMub3B0aW9ucyxcbiAgICAgIGV2ZW50czogdGhpcy5wcm9wcy5ldmVudHMsXG4gICAgfTtcbiAgfVxuICByZW5kZXIoeyBvcHRpb25zIH0sIHsgc3RlcCwgc2VsZWN0ZWRGaWxlLCBwcm9jZXNzZWRGaWxlIH0pIHtcbiAgICBjb25zdCB7IGNsYXNzTmFtZSB9ID0gb3B0aW9ucztcbiAgICByZXR1cm4gKFxuICAgICAgPGRpdiBjbGFzc05hbWU9e2NsYXNzTmFtZX0+XG4gICAgICAgIDxTVkdTeW1ib2xzIC8+XG4gICAgICAgIDxzcGFuIGNsYXNzPXtgJHtjbGFzc05hbWV9LWFuY2hvcmB9Pjwvc3Bhbj5cbiAgICAgICAge3N0ZXAgPT09IDEgJiYgKFxuICAgICAgICAgIDxQaG90b0JveFN0ZXAxIHNlbGVjdEZpbGU9e3RoaXMuc2VsZWN0RmlsZX0gLz5cbiAgICAgICAgKX1cbiAgICAgICAge3N0ZXAgPT09IDIgJiYgKFxuICAgICAgICAgIDxQaG90b0JveFN0ZXAyXG4gICAgICAgICAgICBzZWxlY3RlZEZpbGU9e3NlbGVjdGVkRmlsZX1cbiAgICAgICAgICAgIHByb2Nlc3NGaWxlPXt0aGlzLnByb2Nlc3NGaWxlfVxuICAgICAgICAgIC8+XG4gICAgICAgICl9XG4gICAgICAgIHtzdGVwID09PSAzICYmIChcbiAgICAgICAgICA8UGhvdG9Cb3hTdGVwMyBwcm9jZXNzZWRGaWxlPXtwcm9jZXNzZWRGaWxlfSAvPlxuICAgICAgICApfVxuICAgICAgICB7c3RlcCAhPT0gMyAmJiAoXG4gICAgICAgICAgPFBob3RvQm94UHJvZ3Jlc3Mgc3RlcD17c3RlcH0gLz5cbiAgICAgICAgKX1cbiAgICAgIDwvZGl2PlxuICAgIClcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCB3aXRoQ1NTKFBob3RvQm94LCBjc3MpO1xuIiwiZXhwb3J0IGNsYXNzIE51bGxQaG90b0JveFRhcmdldCB7XG4gIGluaXQoKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgZGVzdHJveSgpIHtcbiAgfVxuICBwb3NpdGlvbigpIHtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgUGhvdG9Cb3hUYXJnZXQge1xuICBjb25zdHJ1Y3RvcihwaG90b0JveCwgJHRhcmdldCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5waG90b0JveCA9IHBob3RvQm94O1xuICAgIHRoaXMuJHRhcmdldCA9ICR0YXJnZXQ7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcblxuICAgIHRoaXMuX2hhbmRsZVRhcmdldENsaWNrID0gdGhpcy5faGFuZGxlVGFyZ2V0Q2xpY2suYmluZCh0aGlzKTtcbiAgICB0aGlzLl9oYW5kbGVXaW5kb3dSZXNpemUgPSB0aGlzLl9oYW5kbGVXaW5kb3dSZXNpemUuYmluZCh0aGlzKTtcblxuICAgIHRoaXMuJHRhcmdldC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIHRoaXMuX2hhbmRsZVRhcmdldENsaWNrKTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigncmVzaXplJywgdGhpcy5faGFuZGxlV2luZG93UmVzaXplKTtcblxuICAgIHRoaXMucGhvdG9Cb3guZXZlbnRzLm9uKCdwb3NpdGlvbjp0YXJnZXQnLCAoKSA9PiB7XG4gICAgICB0aGlzLnBvc2l0aW9uKCk7XG4gICAgfSk7XG4gIH1cbiAgX2hhbmRsZVRhcmdldENsaWNrKGUpIHtcbiAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIHRoaXMucGhvdG9Cb3gudG9nZ2xlKCk7XG4gIH1cbiAgX2hhbmRsZVdpbmRvd1Jlc2l6ZShlKSB7XG4gICAgdGhpcy5wb3NpdGlvbigpO1xuICB9XG4gIGRlc3Ryb3koKSB7XG4gICAgdGhpcy4kdGFyZ2V0LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgdGhpcy5faGFuZGxlVGFyZ2V0Q2xpY2spO1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdyZXNpemUnLCB0aGlzLl9oYW5kbGVXaW5kb3dSZXNpemUpO1xuICB9XG4gIHBvc2l0aW9uKCkge1xuICAgIGNvbnN0IHJlY3QgPSB0aGlzLiR0YXJnZXQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgdGhpcy5waG90b0JveC5zZXRQb3NpdGlvbih7XG4gICAgICB0b3A6IHJlY3QudG9wICsgcmVjdC5oZWlnaHQgKyAoNiAqIDIpLFxuICAgICAgbGVmdDogcmVjdC5sZWZ0IC0gKCh0aGlzLnBob3RvQm94LiRlbC5vZmZzZXRXaWR0aCAvIDIpIC0gKHJlY3Qud2lkdGggLyAyKSksXG4gICAgfSk7XG4gIH1cbn1cbiIsImltcG9ydCB7IGgsIHJlbmRlciB9IGZyb20gJ3ByZWFjdCc7XG5pbXBvcnQgRXZlbnRzIGZyb20gJy4vdXRpbC9FdmVudHMnO1xuaW1wb3J0IFBob3RvQm94Q29tcG9uZW50IGZyb20gJy4vY29tcG9uZW50cy9QaG90b0JveC9QaG90b0JveCc7XG5pbXBvcnQgeyBQaG90b0JveFRhcmdldCwgTnVsbFBob3RvQm94VGFyZ2V0IH0gZnJvbSAnLi9QaG90b0JveFRhcmdldCc7XG5cbmNsYXNzIFBob3RvQm94IHtcbiAgY29uc3RydWN0b3Iob3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy4kY29udGFpbmVyID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignYm9keScpO1xuICAgIHRoaXMuZXZlbnRzID0gbmV3IEV2ZW50cygpO1xuICAgIGNvbnN0IGRlZmF1bHRzID0ge1xuICAgICAgY29sb3JzOiB7XG4gICAgICAgIGJhc2U6ICcjZmZmJyxcbiAgICAgICAgYWNjZW50OiAnIzQ1NTA1NCcsXG4gICAgICAgIGVtcGhhc2lzOiAnIzRjOTUwMSdcbiAgICAgIH0sXG4gICAgICBhdHRhY2hUb1RhcmdldDogbnVsbCxcbiAgICAgIGNsYXNzTmFtZTogJ1Bob3RvQm94JyxcbiAgICAgIHNpemU6IDI0MCxcbiAgICB9O1xuICAgIHRoaXMub3BlbmVkID0gZmFsc2U7XG4gICAgb3B0aW9ucy5zaXplID0gTWF0aC5tYXgoTWF0aC5taW4oMzIwLCBvcHRpb25zLnNpemUpLCAxMjApO1xuICAgIHRoaXMub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIGRlZmF1bHRzLCBvcHRpb25zKTtcblxuICAgIHRoaXMudGFyZ2V0ID0gKFxuICAgICAgdGhpcy5vcHRpb25zLmF0dGFjaFRvVGFyZ2V0XG4gICAgICA/IG5ldyBQaG90b0JveFRhcmdldCh0aGlzLCB0aGlzLm9wdGlvbnMuYXR0YWNoVG9UYXJnZXQpXG4gICAgICA6IG5ldyBOdWxsUGhvdG9Cb3hUYXJnZXQoKVxuICAgICk7XG5cbiAgICB0aGlzLl9oYW5kbGVEb2N1bWVudENsaWNrID0gdGhpcy5faGFuZGxlRG9jdW1lbnRDbGljay5iaW5kKHRoaXMpO1xuICAgIHRoaXMuX2hhbmRsZURvY3VtZW50S2V5dXAgPSB0aGlzLl9oYW5kbGVEb2N1bWVudEtleXVwLmJpbmQodGhpcyk7XG5cbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIHRoaXMuX2hhbmRsZURvY3VtZW50Q2xpY2spO1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2tleXVwJywgdGhpcy5faGFuZGxlRG9jdW1lbnRLZXl1cCk7XG5cbiAgICB0aGlzLiRlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgIHRoaXMuJGVsLmNsYXNzTGlzdC5hZGQoYCR7dGhpcy5vcHRpb25zLmNsYXNzTmFtZX1Db250YWluZXJgKTtcbiAgICB0aGlzLiRlbC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7IGUuc3RvcFByb3BhZ2F0aW9uKCk7IH0pO1xuICAgIHRoaXMuJGVsUHJlYWN0ID0gcmVuZGVyKChcbiAgICAgIDxQaG90b0JveENvbXBvbmVudFxuICAgICAgICBvcHRpb25zPXt0aGlzLm9wdGlvbnN9XG4gICAgICAgIGV2ZW50cz17dGhpcy5ldmVudHN9XG4gICAgICAvPlxuICAgICksIHRoaXMuJGVsKTtcblxuICAgIHRoaXMuJGNvbnRhaW5lci5hcHBlbmRDaGlsZCh0aGlzLiRlbCk7XG4gIH1cbiAgX2hhbmRsZURvY3VtZW50Q2xpY2soZSkge1xuICAgIHRoaXMuY2xvc2UoKTtcbiAgfVxuICBfaGFuZGxlRG9jdW1lbnRLZXl1cChlKSB7XG4gICAgaWYgKGUua2V5Q29kZSA9PT0gMjcpIHtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9XG4gIH1cbiAgZGVzdHJveSgpIHtcbiAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKCdjbGljaycsIHRoaXMuX2hhbmRsZURvY3VtZW50Q2xpY2spO1xuICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2tleXVwJywgdGhpcy5faGFuZGxlRG9jdW1lbnRLZXl1cCk7XG5cbiAgICByZW5kZXIoaCgoKSA9PiBudWxsKSwgdGhpcy4kZWwsIHRoaXMuJGVsUHJlYWN0KTtcbiAgICB0aGlzLiRlbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRoaXMuJGVsKTtcblxuICAgIHRoaXMudGFyZ2V0LmRlc3Ryb3koKTtcbiAgfVxuICB0b2dnbGUoKSB7XG4gICAgdGhpcy5vcGVuZWQgPyB0aGlzLmNsb3NlKCkgOiB0aGlzLm9wZW4oKTtcbiAgfVxuICBvcGVuKCkge1xuICAgIHRoaXMub3BlbmVkID0gdHJ1ZTtcbiAgICB0aGlzLiRlbC5zdHlsZS5vcGFjaXR5ID0gMTtcbiAgICB0aGlzLiRlbC5zdHlsZS5wb2ludGVyRXZlbnRzID0gJ2F1dG8nO1xuICAgIHRoaXMudGFyZ2V0LnBvc2l0aW9uKCk7XG4gIH1cbiAgY2xvc2UoKSB7XG4gICAgdGhpcy4kZWwuc3R5bGUub3BhY2l0eSA9IDA7XG4gICAgdGhpcy4kZWwuc3R5bGUucG9pbnRlckV2ZW50cyA9ICdub25lJztcbiAgICB0aGlzLm9wZW5lZCA9IGZhbHNlO1xuICB9XG4gIHNldFBvc2l0aW9uKHsgdG9wLCBsZWZ0IH0pIHtcbiAgICAod2luZG93LnJlcXVlc3RJZGxlQ2FsbGJhY2sgfHwgd2luZG93LnNldFRpbWVvdXQpKCgpID0+IHtcbiAgICAgIHRoaXMuJGVsLnN0eWxlLnRvcCA9IGAke3RvcH1weGA7XG4gICAgICB0aGlzLiRlbC5zdHlsZS5sZWZ0ID0gYCR7bGVmdH1weGA7XG4gICAgICB0aGlzLmV2ZW50cy5maXJlKCdwb3NpdGlvbicsIHsgdG9wLCBsZWZ0IH0pO1xuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFBob3RvQm94O1xuIl0sIm5hbWVzIjpbIlZOb2RlIiwibm9kZU5hbWUiLCJhdHRyaWJ1dGVzIiwiY2hpbGRyZW4iLCJrZXkiLCJzdGFjayIsImgiLCJsYXN0U2ltcGxlIiwiY2hpbGQiLCJzaW1wbGUiLCJpIiwiYXJndW1lbnRzIiwibGVuZ3RoIiwicHVzaCIsInBvcCIsIkFycmF5IiwiU3RyaW5nIiwicCIsInVuZGVmaW5lZCIsIm9wdGlvbnMiLCJ2bm9kZSIsImV4dGVuZCIsIm9iaiIsInByb3BzIiwiY2xvbmUiLCJkZWx2ZSIsInNwbGl0IiwiaXNGdW5jdGlvbiIsImlzU3RyaW5nIiwiaGFzaFRvQ2xhc3NOYW1lIiwiYyIsInN0ciIsInByb3AiLCJsY0NhY2hlIiwidG9Mb3dlckNhc2UiLCJzIiwicmVzb2x2ZWQiLCJQcm9taXNlIiwicmVzb2x2ZSIsImRlZmVyIiwidGhlbiIsImYiLCJzZXRUaW1lb3V0IiwiY2xvbmVFbGVtZW50Iiwic2xpY2UiLCJjYWxsIiwiTk9fUkVOREVSIiwiU1lOQ19SRU5ERVIiLCJGT1JDRV9SRU5ERVIiLCJBU1lOQ19SRU5ERVIiLCJFTVBUWSIsIkFUVFJfS0VZIiwiU3ltYm9sIiwiZm9yIiwiTk9OX0RJTUVOU0lPTl9QUk9QUyIsImJveEZsZXhHcm91cCIsImNvbHVtbkNvdW50IiwiZmlsbE9wYWNpdHkiLCJmbGV4IiwiZmxleEdyb3ciLCJmbGV4U2hyaW5rIiwiZmxleE5lZ2F0aXZlIiwiZm9udFdlaWdodCIsImxpbmVDbGFtcCIsImxpbmVIZWlnaHQiLCJvcmRlciIsIm9ycGhhbnMiLCJzdHJva2VPcGFjaXR5Iiwid2lkb3dzIiwiekluZGV4Iiwiem9vbSIsIk5PTl9CVUJCTElOR19FVkVOVFMiLCJibHVyIiwiZXJyb3IiLCJmb2N1cyIsImxvYWQiLCJyZXNpemUiLCJzY3JvbGwiLCJjcmVhdGVMaW5rZWRTdGF0ZSIsImNvbXBvbmVudCIsImV2ZW50UGF0aCIsInBhdGgiLCJlIiwidCIsInRhcmdldCIsInN0YXRlIiwidiIsInR5cGUiLCJtYXRjaCIsImNoZWNrZWQiLCJ2YWx1ZSIsInNldFN0YXRlIiwiaXRlbXMiLCJlbnF1ZXVlUmVuZGVyIiwiX2RpcnR5IiwiZGVib3VuY2VSZW5kZXJpbmciLCJyZXJlbmRlciIsImxpc3QiLCJyZW5kZXJDb21wb25lbnQiLCJpc0Z1bmN0aW9uYWxDb21wb25lbnQiLCJwcm90b3R5cGUiLCJyZW5kZXIiLCJidWlsZEZ1bmN0aW9uYWxDb21wb25lbnQiLCJjb250ZXh0IiwiZ2V0Tm9kZVByb3BzIiwiaXNTYW1lTm9kZVR5cGUiLCJub2RlIiwiVGV4dCIsIl9jb21wb25lbnRDb25zdHJ1Y3RvciIsImlzTmFtZWROb2RlIiwibm9ybWFsaXplZE5vZGVOYW1lIiwiZGVmYXVsdFByb3BzIiwicmVtb3ZlTm9kZSIsInBhcmVudE5vZGUiLCJyZW1vdmVDaGlsZCIsInNldEFjY2Vzc29yIiwibmFtZSIsIm9sZCIsImlzU3ZnIiwiY2xhc3NOYW1lIiwic3R5bGUiLCJjc3NUZXh0IiwiaW5uZXJIVE1MIiwiX19odG1sIiwibCIsIl9saXN0ZW5lcnMiLCJzdWJzdHJpbmciLCJhZGRFdmVudExpc3RlbmVyIiwiZXZlbnRQcm94eSIsInJlbW92ZUV2ZW50TGlzdGVuZXIiLCJyZW1vdmVBdHRyaWJ1dGUiLCJucyIsInJlbW92ZUF0dHJpYnV0ZU5TIiwic2V0QXR0cmlidXRlTlMiLCJzZXRBdHRyaWJ1dGUiLCJzZXRQcm9wZXJ0eSIsImV2ZW50Iiwibm9kZXMiLCJjb2xsZWN0Tm9kZSIsIkVsZW1lbnQiLCJfY29tcG9uZW50IiwiY3JlYXRlTm9kZSIsImRvY3VtZW50IiwiY3JlYXRlRWxlbWVudE5TIiwiY3JlYXRlRWxlbWVudCIsIm1vdW50cyIsImRpZmZMZXZlbCIsImlzU3ZnTW9kZSIsImh5ZHJhdGluZyIsImZsdXNoTW91bnRzIiwiYWZ0ZXJNb3VudCIsImNvbXBvbmVudERpZE1vdW50IiwiZGlmZiIsImRvbSIsIm1vdW50QWxsIiwicGFyZW50IiwiY29tcG9uZW50Um9vdCIsIlNWR0VsZW1lbnQiLCJyZXQiLCJpZGlmZiIsImFwcGVuZENoaWxkIiwib3JpZ2luYWxBdHRyaWJ1dGVzIiwibm9kZVZhbHVlIiwicmVjb2xsZWN0Tm9kZVRyZWUiLCJjcmVhdGVUZXh0Tm9kZSIsImJ1aWxkQ29tcG9uZW50RnJvbVZOb2RlIiwib3V0IiwidmNoaWxkcmVuIiwiZmlyc3RDaGlsZCIsInJlcGxhY2VDaGlsZCIsImZjIiwiYSIsIm5leHRTaWJsaW5nIiwicmVmIiwicHJldlN2Z01vZGUiLCJpbm5lckRpZmZOb2RlIiwib3JpZ2luYWxDaGlsZHJlbiIsImNoaWxkTm9kZXMiLCJrZXllZCIsImtleWVkTGVuIiwibWluIiwibGVuIiwiY2hpbGRyZW5MZW4iLCJ2bGVuIiwiaiIsInZjaGlsZCIsIl9fa2V5IiwiaW5zZXJ0QmVmb3JlIiwidW5tb3VudE9ubHkiLCJsYXN0Q2hpbGQiLCJkaWZmQXR0cmlidXRlcyIsImF0dHJzIiwiY29tcG9uZW50cyIsImNvbGxlY3RDb21wb25lbnQiLCJjb25zdHJ1Y3RvciIsImNyZWF0ZUNvbXBvbmVudCIsIkN0b3IiLCJpbnN0IiwibmV4dEJhc2UiLCJzcGxpY2UiLCJzZXRDb21wb25lbnRQcm9wcyIsIm9wdHMiLCJfZGlzYWJsZSIsIl9fcmVmIiwiYmFzZSIsImNvbXBvbmVudFdpbGxNb3VudCIsImNvbXBvbmVudFdpbGxSZWNlaXZlUHJvcHMiLCJwcmV2Q29udGV4dCIsInByZXZQcm9wcyIsInN5bmNDb21wb25lbnRVcGRhdGVzIiwiaXNDaGlsZCIsInNraXAiLCJyZW5kZXJlZCIsInByZXZpb3VzUHJvcHMiLCJwcmV2aW91c1N0YXRlIiwicHJldlN0YXRlIiwicHJldmlvdXNDb250ZXh0IiwiaXNVcGRhdGUiLCJpbml0aWFsQmFzZSIsImluaXRpYWxDaGlsZENvbXBvbmVudCIsImNiYXNlIiwic2hvdWxkQ29tcG9uZW50VXBkYXRlIiwiY29tcG9uZW50V2lsbFVwZGF0ZSIsImdldENoaWxkQ29udGV4dCIsImNoaWxkQ29tcG9uZW50IiwidG9Vbm1vdW50IiwiY2hpbGRQcm9wcyIsIl9wYXJlbnRDb21wb25lbnQiLCJiYXNlUGFyZW50IiwiY29tcG9uZW50UmVmIiwidW5zaGlmdCIsImNvbXBvbmVudERpZFVwZGF0ZSIsImFmdGVyVXBkYXRlIiwiY2IiLCJfcmVuZGVyQ2FsbGJhY2tzIiwiZm4iLCJvbGREb20iLCJpc0RpcmVjdE93bmVyIiwiaXNPd25lciIsInVubW91bnRDb21wb25lbnQiLCJyZW1vdmUiLCJiZWZvcmVVbm1vdW50IiwiY29tcG9uZW50V2lsbFVubW91bnQiLCJpbm5lciIsImNvbXBvbmVudERpZFVubW91bnQiLCJDb21wb25lbnQiLCJfbGlua2VkU3RhdGVzIiwiY2FsbGJhY2siLCJtZXJnZSIsIkV2ZW50cyIsInRhcmdldHMiLCJldmVudFR5cGUiLCJmaWx0ZXIiLCJhcmdzIiwiZm9yRWFjaCIsIlNWR1N5bWJvbHMiLCJJY29uIiwiaGV4VG9SZ2IiLCJfaGV4IiwiaGV4IiwiciIsInBhcnNlSW50IiwiZyIsImIiLCJFcnJvciIsInJnYmEiLCJhbHBoYSIsIndpdGhDU1MiLCJXcmFwcGVkQ29tcG9uZW50IiwiY3NzIiwiV2l0aENTUyIsInRoZW1lIiwiY29sb3JzIiwic2l6ZSIsIiRzdHlsZSIsImhlYWQiLCJwcmltYXJ5Q29sb3IiLCJzZWNvbmRhcnlDb2xvciIsImFjY2VudCIsInRlcnRpYXJ5Q29sb3IiLCJlbXBoYXNpcyIsInNldHRpbmdzIiwicnVsZXMiLCJtYXAiLCJ0cmltIiwiYXJyIiwibmV3UiIsInJ1bGUiLCJzaGVldCIsImluc2VydFJ1bGUiLCJjbGFzc25hbWVzIiwicmVkdWNlIiwiYWNjIiwiY3VyciIsImNvbmNhdCIsIk9iamVjdCIsImtleXMiLCJrIiwiam9pbiIsIlBob3RvQm94QWN0aW9uQmFySXRlbSIsImljb24iLCJpc1NlbGVjdGVkIiwib25QcmVzcyIsImlzRW1waGFzaXplZCIsIlBob3RvQm94QWN0aW9uQmFyTGlzdCIsIlBob3RvQm94QWN0aW9uQmFyIiwiZGF0YVVybFRvQmxvYiIsImRhdGFVUkwiLCJCQVNFNjRfTUFSS0VSIiwiaW5kZXhPZiIsInBhcnRzIiwiY29udGVudFR5cGUiLCJyYXciLCJCbG9iIiwid2luZG93IiwiYXRvYiIsInJhd0xlbmd0aCIsInVJbnQ4QXJyYXkiLCJVaW50OEFycmF5IiwiY2hhckNvZGVBdCIsIlBob3RvQm94U3RlcDEiLCJoYW5kbGVBY3Rpb25Cb3hDbGljayIsIiRmaWxlQ2hvb3NlciIsImRpc3BhdGNoRXZlbnQiLCJNb3VzZUV2ZW50IiwiX2hhbmRsZUZpbGVJbnB1dENoYW5nZSIsInNlbGVjdGVkRmlsZSIsImZpbGVzIiwicmVhZGVyIiwiRmlsZVJlYWRlciIsIm9ubG9hZCIsImJhc2U2NERhdGEiLCJyZXN1bHQiLCJzZWxlY3RGaWxlIiwicmVhZEFzRGF0YVVSTCIsIiRlbCIsInRleHRBbGlnbiIsIk1vdXNlTW92ZXIiLCJ4IiwieSIsInByZXNzZWQiLCJfd2lkdGgiLCJfaGVpZ2h0Iiwic2V0U3RhdGVGcm9tRXZlbnQiLCJ3aWR0aCIsImN1cnJlbnRUYXJnZXQiLCJvZmZzZXRXaWR0aCIsImhlaWdodCIsIm9mZnNldEhlaWdodCIsIk1hdGgiLCJtYXgiLCJvZmZzZXRYIiwib2Zmc2V0WSIsIm9uQ2hhbmdlIiwiaGFuZGxlQ2hhbmdlIiwiZWwiLCJTbGlkZXIiLCJsZWZ0IiwidG9GaXhlZCIsIk1vdXNlRHJhZ2dlciIsImRlbHRhWSIsInByZXZYIiwicHJldlkiLCJkZWx0YVgiLCJQaG90b0JveFN0ZXAyIiwiZnJhbWVTaXplIiwiaGFuZGxlU2F2ZUNsaWNrIiwicHJvY2Vzc0ZpbGUiLCJuZXdDYW52YXMiLCJuZXdDb250ZXh0IiwiZ2V0Q29udGV4dCIsImRyYXdJbWFnZSIsImNhbnZhcyIsInRvRGF0YVVSTCIsImJsb2IiLCJvblNsaWRlckNoYW5nZSIsInBlcmNlbnQiLCJjaGFuZ2VzIiwibmV3SW1hZ2VTaXplIiwiaW1hZ2VYIiwiaW1hZ2VZIiwiaW1hZ2VTaXplIiwiaGFuZGxlTW91c2VEcmFnZ2VyQ2hhbmdlIiwibmV3SW1hZ2VYIiwibmV3SW1hZ2VZIiwiX2RyYXdJbWFnZSIsImltZ0RhdGFBc0Jhc2U2NCIsImltZyIsIkltYWdlIiwiY2xlYXJSZWN0Iiwic3JjIiwiY2FudmFzU2l6ZSIsIiRwcmV2aWV3IiwiYmFzZTY0IiwiZHJhZ2dpbmciLCJkaXNwbGF5IiwianVzdGlmeUNvbnRlbnQiLCJzZW5kRmlsZSIsInVybCIsImZpbGUiLCJvblByb2dyZXNzIiwib25Db21wbGV0ZSIsImRhdGEiLCJGb3JtRGF0YSIsImFwcGVuZCIsInhociIsIlhNTEh0dHBSZXF1ZXN0IiwidXBsb2FkIiwiZXZ0IiwibGVuZ3RoQ29tcHV0YWJsZSIsImxvYWRlZCIsInRvdGFsIiwid2FybiIsImxvZyIsInN0YXR1cyIsIm9wZW4iLCJzZW5kIiwiUGhvdG9Cb3hTdGVwMyIsInByb2Nlc3NlZEZpbGUiLCJwcm9ncmVzcyIsIlBob3RvQm94UHJvZ3Jlc3MiLCJzdGVwIiwiY2xhc3NlcyIsIlBob3RvQm94IiwiZXZlbnRzIiwiZmlyZSIsIk51bGxQaG90b0JveFRhcmdldCIsIlBob3RvQm94VGFyZ2V0IiwicGhvdG9Cb3giLCIkdGFyZ2V0IiwiX2hhbmRsZVRhcmdldENsaWNrIiwiYmluZCIsIl9oYW5kbGVXaW5kb3dSZXNpemUiLCJvbiIsInBvc2l0aW9uIiwic3RvcFByb3BhZ2F0aW9uIiwidG9nZ2xlIiwicmVjdCIsImdldEJvdW5kaW5nQ2xpZW50UmVjdCIsInNldFBvc2l0aW9uIiwidG9wIiwiJGNvbnRhaW5lciIsInF1ZXJ5U2VsZWN0b3IiLCJkZWZhdWx0cyIsIm9wZW5lZCIsImFzc2lnbiIsImF0dGFjaFRvVGFyZ2V0IiwiX2hhbmRsZURvY3VtZW50Q2xpY2siLCJfaGFuZGxlRG9jdW1lbnRLZXl1cCIsImNsYXNzTGlzdCIsImFkZCIsIiRlbFByZWFjdCIsImNsb3NlIiwia2V5Q29kZSIsImRl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
