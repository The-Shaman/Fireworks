/** @license
 * DHTML Snowstorm! JavaScript-based snow for web pages, 
 * ported from https://github.com/scottschiller/Snowstorm for fandom wikis
 * -----------------------------------------------------------
 * Version 1.44.20131215 (Previous rev: 1.44.20131208)
 * Copyright (c) 2007, Scott Schiller. All rights reserved.
 * Code provided under the BSD License
 * https://github.com/scottschiller/Snowstorm/blob/master/license.txt
 */

/*jslint nomen: true, plusplus: true, sloppy: true, vars: true, white: true */
/*global window, document, navigator, clearInterval, setInterval */
window.fireworkShow = (new function() { // jshint ignore:line
	var defaults = {
		autoStart: true, // Whether the snow should start automatically or not.
		excludeMobile: true, // Snow is likely to be bad news for mobile phones' CPUs (and batteries.) Enable at your own risk.
		rocketsMax: 4, // Make this flakesMaxActive/16 (warning: this ratio hasn't been tested so don't trust it)
		flakesMax: 128, // Limit total amount of snow made (falling + sticking)
		flakesMaxActive: 64,  // Limit amount of snow falling at once (less = lower CPU use)
		animationInterval: 35, // Theoretical "milliseconds per frame" measurement. 20 = fast + smooth, but high 
							// CPU use. 50 = more conservative, but slower
		useGPU: true, // Enable transform-based hardware acceleration, reduce CPU load.
		className: null, // CSS class name for further customization on snow elements
		flakeBottom: null, // Integer for Y axis snow limit, 0 or null for "full-screen" snow effect
		followMouse: true, // Snow movement can respond to the user's mouse
		starCharacter: '&bull;', // &bull; = bullet, &middot, is square on some systems etc.
		targetElement: null, // element which snow will be appended to (null = document.body) - can be an element 
	// ID eg. 'myDiv', or a DOM node reference
		useFadeEffect: true, // When recycling fallen snow (or rarely, when falling), have it "melt" and fade out 
	// if browser supports it
		useTwinkleEffect: false, // Allow snow to randomly "flicker" in and out of view while falling
		usePositionFixed: false, // true = snow does not shift vertically when scrolling. May increase CPU load, 
	// disabled by default - if enabled, used only where supported
		usePixelPosition: false, // Whether to use pixel values for snow top/left vs. percentages. Auto-enabled if 
	// body is position:relative or targetElement is specified.

		// --- less-used bits ---
		freezeOnBlur: true, // Only snow when the window is in focus (foreground.) Saves CPU.
		flakeLeftOffset: 0, // Left margin/gutter space on edge of container (eg. browser window.) Bump up these values if seeing horizontal scrollbars.
		flakeRightOffset: 0, // Right margin/gutter space on edge of container
		flakeWidth: 8, // Max pixel width reserved for snow element
		flakeHeight: 8, // Max pixel height reserved for snow element
		vMaxX: 5, // Maximum X velocity range for snow
		vMaxY: 4, // Maximum Y velocity range for snow
		zIndex: -1, // CSS stacking order applied to each snowflake
		windOffset: 1,
		windMultiplier: 2,
		flakeTypes: 6,
	};
	
	var config = Object.assign(defaults, window.fireworkShow || {});
	
	// Support deprecated configuration parameters - support will be removed at any time without warning
	Object.keys(defaults).forEach(function(key) {
		if (key in window) {
			console.warn('[SnowStorm] You are using a deprecated configuration key `' + key + '`. Please see <https://dev.fandom.com/wiki/SnowStorm> for supported parameter.');
			config[key] = window[key];
		}
	});
	
	Object.assign(this, config);

	// --- "No user-serviceable parts inside" past this point, yadda yadda ---
	var show = this,
		features,
		// UA sniffing and backCompat rendering mode checks for fixed position, etc.
		isIE = navigator.userAgent.match(/msie/i),
		isIE6 = navigator.userAgent.match(/msie 6/i),
		isMobile = navigator.userAgent.match(/mobile|opera m(ob|in)/i),
		isBackCompatIE = (isIE && document.compatMode === 'BackCompat'),
		noFixed = (isBackCompatIE || isIE6),
		screenX = null,
		screenX2 = null,
		screenY = null,
		scrollY = null,
		docHeight = null,
		vRndX = null,
		vRndY = null,
		fixedForEverything = false,
		targetElementIsRelative = false,
		opacitySupported = (function() {
			try {
				document.createElement('div').style.opacity = '0.5';
			} catch(e) {
				return false;
			}
			return true;
		}()),
		didInit = false,
		docFrag = document.createDocumentFragment();

	features = (function() {
		var getAnimationFrame;

		/**
		 * hat tip: paul irish
		 * https://www.paulirish.com/2011/requestanimationframe-for-smart-animating/
		 * https://gist.github.com/838785
		 */
		function timeoutShim(callback) {
			window.setTimeout(callback, 1000 / (show.animationInterval || 20));
		}

		var _animationFrame = (window.requestAnimationFrame ||
			window.webkitRequestAnimationFrame ||
			window.mozRequestAnimationFrame ||
			window.oRequestAnimationFrame ||
			window.msRequestAnimationFrame ||
			timeoutShim);

		// apply to window, avoid "illegal invocation" errors in Chrome
		getAnimationFrame = _animationFrame ? function() {
			return _animationFrame.apply(window, arguments);
		} : null;

		var testDiv = document.createElement('div');

		function has(prop) {
			// test for feature support
			var result = testDiv.style[prop];
			return result !== undefined ? prop : null;
		}

		// note local scope.
		var localFeatures = {
			transform: {
				ie: has('-ms-transform'),
				moz: has('MozTransform'),
				opera: has('OTransform'),
				webkit: has('webkitTransform'),
				w3: has('transform'),
				prop: null // the normalized property value
			},

			getAnimationFrame: getAnimationFrame
		};

		localFeatures.transform.prop = (
			localFeatures.transform.w3 ||
			localFeatures.transform.moz ||
			localFeatures.transform.webkit ||
			localFeatures.transform.ie ||
			localFeatures.transform.opera
		);

		testDiv = null;
		return localFeatures;
	}());

	this.timer = null;
	this.flakes = [];
	this.rockets = [];
	this.disabled = false;
	this.active = false;
	this.meltFrameCount = 20;
	this.meltFrames = [];

	this.setXY = function(o, x, y) {
		if (!o) return false;

		if (show.usePixelPosition || targetElementIsRelative) {
			o.style.left = (x - show.flakeWidth) + 'px';
			o.style.top = (y - show.flakeHeight) + 'px';
		} else if (noFixed) {
			o.style.right = (100 - (x / screenX * 100)) + '%';
			// avoid creating vertical scrollbars
			o.style.top = (Math.min(y, docHeight - show.flakeHeight)) + 'px';
		} else {
			if (!show.flakeBottom) {
				// if not using a fixed bottom coordinate...
				o.style.right = (100 - (x / screenX * 100)) + '%';
				o.style.bottom = (100 - (y / screenY * 100)) + '%';
			} else {
				// absolute top.
				o.style.right = (100 - (x / screenX * 100)) + '%';
				o.style.top = (Math.min(y, docHeight - show.flakeHeight)) + 'px';
			}
		}
	};

	this.events = (function() {
		var old = !window.addEventListener && window.attachEvent,
			slice = Array.prototype.slice,
			evt = {
				add: old ? 'attachEvent' : 'addEventListener',
				remove: old ? 'detachEvent' : 'removeEventListener',
			};

		function getArgs(oArgs) {
			var args = slice.call(oArgs),
				len = args.length;
			if (old) {
				args[1] = 'on' + args[1]; // prefix
				if (len > 3) {
					args.pop(); // no capture
				}
			} else if (len === 3) {
				args.push(false);
			}
			return args;
		}

		function apply(args, sType) {
			var element = args.shift(),
				method = [evt[sType]];
			if (old) {
				element[method](args[0], args[1]);
			} else {
				element[method].apply(element, args);
			}
		}

		function addEvent() {
			apply(getArgs(arguments), 'add');
		}

		function removeEvent() {
			apply(getArgs(arguments), 'remove');
		}

		return {
			add: addEvent,
			remove: removeEvent
		};
	}());

	function rnd(n, min) {
		if (isNaN(min)) min = 0;
		
		return (Math.random() * n) + min;
	}

	function plusMinus(n) {
		return parseInt(rnd(2), 10) === 1 ? n * -1 : n;
	}

	this.scrollHandler = function() {
		var i;
		// "attach" snowflakes to bottom of window if no absolute bottom value was given
		scrollY = (show.flakeBottom ? 0 : parseInt(window.scrollY || document.documentElement.scrollTop || (noFixed ? document.body.scrollTop : 0), 10));
		if (isNaN(scrollY)) scrollY = 0; // Netscape 6 scroll fix
		if (!fixedForEverything && !show.flakeBottom && show.flakes) {
			for(i = 0; i < show.flakes.length; i++) {
				if (show.flakes[i].active === 0) {
					show.flakes[i].stick();
				}
			}
		}
	};

	this.resizeHandler = function() {
		if (window.innerWidth || window.innerHeight) {
			screenX = window.innerWidth - 16 - show.flakeRightOffset;
			screenY = (show.flakeBottom || window.innerHeight);
		} else {
			screenX = (document.documentElement.clientWidth || document.body.clientWidth || document.body.scrollWidth) - (!isIE ? 8 : 0) - show.flakeRightOffset;
			screenY = show.flakeBottom || document.documentElement.clientHeight || document.body.clientHeight || document.body.scrollHeight;
		}
		docHeight = document.body.offsetHeight;
		screenX2 = parseInt(screenX / 2, 10);
	};

	this.resizeHandlerAlt = function() {
		screenX = show.targetElement.offsetWidth - show.flakeRightOffset;
		screenY = show.flakeBottom || show.targetElement.offsetHeight;
		screenX2 = parseInt(screenX / 2, 10);
		docHeight = document.body.offsetHeight;
	};

	this.freeze = function() {
		// pause animation
		if (!show.disabled) {
			show.disabled = 1;
		} else {
			return false;
		}
		show.timer = null;
	};

	this.resume = function() {
		if (show.disabled) {
			show.disabled = 0;
		} else {
			return false;
		}
		show.timerInit();
	};

	this.toggleSnow = function() {
		if (!show.flakes.length) {
			// first run
			show.start();
		} else {
			show.active = !show.active;
			if (show.active) {
				show.show();
				show.resume();
			} else {
				show.stop();
				show.freeze();
			}
		}
	};

	this.stop = function() {
		var i;
		this.freeze();
		for(i = 0; i < this.flakes.length; i++) {
			this.flakes[i].o.style.display = 'none';
		}
		show.events.remove(window, 'scroll', show.scrollHandler);
		show.events.remove(window, 'resize', show.resizeHandler);
		if (show.freezeOnBlur) {
			if (isIE) {
				show.events.remove(document, 'focusout', show.freeze);
				show.events.remove(document, 'focusin', show.resume);
			} else {
				show.events.remove(window, 'blur', show.freeze);
				show.events.remove(window, 'focus', show.resume);
			}
		}
	};

	this.show = function() {
		var i;
		for(i = 0; i < this.flakes.length; i++) {
			this.flakes[i].o.style.display = 'block';
		}
	};

	this.fireworkStar = function(x, y) {
		var s = this;
		this.x = x || parseInt(rnd(screenX - 20), 10);
		this.y = (!isNaN(y) ? y : -rnd(screenY) - 12);
		this.vX = null;
		this.vY = null;
		this.vAmpTypes = [1, 1.2, 1.4, 1.6, 1.8]; // "amplification" for vX/vY (based on flake size/type)
		this.vAmp = this.vAmpTypes[this.type] || 1;
		this.melting = false;
		this.meltFrameCount = show.meltFrameCount;
		this.meltFrames = show.meltFrames;
		this.meltFrame = 0;
		this.twinkleFrame = 0;
		this.active = 1;
		this.fontSize = (10 + (this.type / 5) * 10);
		this.o = document.createElement('div');
		this.o.innerHTML = show.starCharacter;
		if (show.className) {
			this.o.setAttribute('class', show.className);
		}
		//this.o.style.color = show.snowColor;
		this.o.style.position = (fixedForEverything ? 'fixed' : 'absolute');
		if (show.useGPU && features.transform.prop) {
			// GPU-accelerated snow.
			this.o.style[features.transform.prop] = 'translate3d(0px, 0px, 0px)';
		}
		this.o.style.width = show.flakeWidth + 'px';
		this.o.style.height = show.flakeHeight + 'px';
		this.o.style.fontFamily = 'arial,verdana';
		this.o.style.cursor = 'default';
		this.o.style.overflow = 'hidden';
		this.o.style.fontWeight = 'normal';
		this.o.style.zIndex = show.zIndex;
		docFrag.appendChild(this.o);

		this.refresh = function() {
			if (isNaN(s.x) || isNaN(s.y)) {
				// safety check
				return false;
			}
			show.setXY(s.o, s.x, s.y);
		};

		this.stick = function() {
			if (noFixed || (show.targetElement !== document.documentElement && show.targetElement !== document.body)) {
				s.o.style.top = (screenY + scrollY - show.flakeHeight) + 'px';
			} else if (show.flakeBottom) {
				s.o.style.top = show.flakeBottom + 'px';
			} else {
				s.o.style.display = 'none';
				s.o.style.top = 'auto';
				s.o.style.bottom = '0%';
				s.o.style.position = 'fixed';
				s.o.style.display = 'block';
			}
		};

		this.vCheck = function() {
			if (s.vX >= 0 && s.vX < 0.2) {
				s.vX = 0.2;
			} else if (s.vX < 0 && s.vX > -0.2) {
				s.vX = -0.2;
			}
			if (s.vY >= 0 && s.vY < 0.2) {
				s.vY = 0.2;
			}
		};

		this.move = function() {
			var vX = s.vX * show.windOffset,
				yDiff;
			s.x += vX;
			s.y += (s.vY * s.vAmp);
			if (s.x >= screenX || screenX - s.x < show.flakeWidth) { // X-axis scroll check
				s.x = 0;
			} else if (vX < 0 && s.x - show.flakeLeftOffset < -show.flakeWidth) {
				s.x = screenX - show.flakeWidth - 1; // flakeWidth;
			}
			s.refresh();
			yDiff = screenY + scrollY - s.y + show.flakeHeight;
			if (yDiff < show.flakeHeight) {
				s.active = 0;
				if (show.snowStick) {
					s.stick();
				} else {
					s.recycle();
				}
			} else {
				if (show.useMeltEffect && s.active && s.type < 3 && !s.melting && Math.random() > 0.998) {
					// ~1/1000 chance of melting mid-air, with each frame
					s.melting = true;
					s.melt();
					// only incrementally melt one frame
					// s.melting = false;
				}
				if (show.useTwinkleEffect) {
					if (s.twinkleFrame < 0) {
						if (Math.random() > 0.97) {
							s.twinkleFrame = parseInt(Math.random() * 8, 10);
						}
					} else {
						s.twinkleFrame--;
						if (!opacitySupported) {
							s.o.style.visibility = (s.twinkleFrame && s.twinkleFrame % 2 === 0 ? 'hidden' : 'visible');
						} else {
							s.o.style.opacity = (s.twinkleFrame && s.twinkleFrame % 2 === 0 ? 0 : 1);
						}
					}
				}
			}
		};

		this.setVelocities = function() {
			s.vX = vRndX + rnd(show.vMaxX * 0.12, 0.1);
			s.vY = vRndY + rnd(show.vMaxY * 0.12, 0.1);
		};

		this.setOpacity = function(o, opacity) {
			if (!opacitySupported) {
				return false;
			}
			o.style.opacity = opacity;
		};

		this.melt = function() {
			if (!show.useMeltEffect || !s.melting) {
				s.recycle();
			} else {
				if (s.meltFrame < s.meltFrameCount) {
					s.setOpacity(s.o, s.meltFrames[s.meltFrame]);
					s.o.style.fontSize = s.fontSize - (s.fontSize * (s.meltFrame / s.meltFrameCount)) + 'px';
					s.o.style.lineHeight = show.flakeHeight + 2 + (show.flakeHeight * 0.75 * (s.meltFrame / s.meltFrameCount)) + 'px';
					s.meltFrame++;
				} else {
					s.recycle();
				}
			}
		};

		this.recycle = function() {
			s.o.style.display = 'none';
			s.o.style.position = (fixedForEverything ? 'fixed' : 'absolute');
			s.o.style.bottom = 'auto';
			s.setVelocities();
			s.vCheck();
			s.meltFrame = 0;
			s.melting = false;
			s.setOpacity(s.o, 1);
			s.o.style.padding = '0px';
			s.o.style.margin = '0px';
			s.o.style.fontSize = s.fontSize + 'px';
			s.o.style.lineHeight = (show.flakeHeight + 2) + 'px';
			s.o.style.textAlign = 'center';
			s.o.style.verticalAlign = 'baseline';
			s.x = parseInt(rnd(screenX - show.flakeWidth - 20), 10);
			s.y = parseInt(rnd(screenY) * -1, 10) - show.flakeHeight;
			s.refresh();
			s.o.style.display = 'block';
			s.active = 1;
		};

		this.recycle(); // set up x/y coords etc.
		this.refresh();
	};

	this.fireworkRocket = function(type, x, targetY) {
		var r = this;
		this.type = type;
		this.x = x || parseInt(rnd(screenX - 20), 10);
		this.y = screenY;
		this.vX = null; // x velocity
		this.vY = null;	// y velocity
		this.tY = targetY; // target Y value for rocket to explode at.
		this.active = 1;
		this.fontSize = (10 + (this.type / 5) * 10);
		this.o = document.createElement('div');
		this.o.innerHTML = show.starCharacter;
		if (show.className) {
			this.o.setAttribute('class', show.className);
		}
		this.o.style.color = '#fff';
		this.o.style.position = (fixedForEverything ? 'fixed' : 'absolute');
		if (show.useGPU && features.transform.prop) {
			// GPU-accelerated snow.
			this.o.style[features.transform.prop] = 'translate3d(0px, 0px, 0px)';
		}
		this.o.style.width = show.flakeWidth + 'px';
		this.o.style.height = show.flakeHeight + 'px';
		this.o.style.fontFamily = 'arial,verdana';
		this.o.style.cursor = 'default';
		this.o.style.overflow = 'hidden';
		this.o.style.fontWeight = 'normal';
		this.o.style.zIndex = show.zIndex;
		docFrag.appendChild(this.o);

		this.refresh = function() {
			if (isNaN(r.x) || isNaN(r.y)) {
				// safety check
				return false;
			}
			show.setXY(r.o, r.x, r.y);
		};

		this.move = function() {
			r.x += r.vX;
			r.y -= r.vY;
			r.vX *= 7/8;
			r.vY *= 3/4;
			r.refresh();
			if (r.y < r.targetY) {
				r.explode();	
			}
		};

		this.explode = function() {
			r.active = Math.floor(Math.random() * 175 - 75) + 75 + 1;
			// Summon firework stars here
		};

		this.setVelocities = function() {
			// Hey change this code later
			r.vX = vRndX + rnd(show.vMaxX * 0.12, 0.1);
			r.vY = vRndY + rnd(show.vMaxY * 0.12, 0.1);
		};

		this.setOpacity = function(o, opacity) {
			if (!opacitySupported) {
				return false;
			}
			o.style.opacity = opacity;
		};

		this.recycle = function() {
			r.o.style.display = 'none';
			r.o.style.position = (fixedForEverything ? 'fixed' : 'absolute');
			r.o.style.bottom = 'auto';
			r.setVelocities();
			r.setOpacity(r.o, 1);
			r.o.style.padding = '0px';
			r.o.style.margin = '0px';
			r.o.style.fontSize = r.fontSize + 'px';
			r.o.style.lineHeight = (show.flakeHeight + 2) + 'px';
			r.o.style.textAlign = 'center';
			r.o.style.verticalAlign = 'baseline';
			r.x = parseInt(rnd(screenX - show.flakeWidth - 20), 10);
			r.y = screenY;
			r.refresh();
			r.o.style.display = 'block';
			r.active = 1;
		};

		this.recycle(); // set up x/y coords etc.
		this.refresh();
	};

	this.fireworks = function() {
		var active = 0,
			flake = null,
			i, j;
		for(i = 0, j = show.flakes.length; i < j; i++) {
			if (show.flakes[i].active === 1) {
				show.flakes[i].move();
				active++;
			}
			if (show.flakes[i].melting) {
				show.flakes[i].melt();
			}
		}
		for (i = 0, j = show.rockets.length; i < j; i++) {
			if (show.rockets[i].active === 1) {
				show.rockets[i].move();
			} else if (show.rockets[i].active === 2) {
				show.rockets[i].refresh();
			} else {
				show.rockets[i].active--;
			}
		}
		if (show.timer) {
			features.getAnimationFrame(show.fireworks);
		}
	};

	this.mouseMove = function(e) {
		if (!show.followMouse) {
			return true;
		}
		var x = parseInt(e.clientX, 10);
		if (x < screenX2) {
			show.windOffset = -show.windMultiplier + (x / screenX2 * show.windMultiplier);
		} else {
			x -= screenX2;
			show.windOffset = (x / screenX2) * show.windMultiplier;
		}
	};

	this.createRocket = function(limit, allowInactive) {
		var i;
		for(i = 0; i < limit; i++) {
			show.rockets[show.rockets.length] = new show.fireworkRocket(parseInt(rnd(show.flakeTypes), 10));
		}
		show.targetElement.appendChild(docFrag);
	};

	this.timerInit = function() {
		show.timer = true;
		show.fireworks();
	};

	this.init = function() {
		var i;
		for(i = 0; i < show.meltFrameCount; i++) {
			show.meltFrames.push(1 - (i / show.meltFrameCount));
		}
		show.createRocket(show.rocketsMax); // create initial batch
		show.events.add(window, 'resize', show.resizeHandler);
		show.events.add(window, 'scroll', show.scrollHandler);
		if (show.freezeOnBlur) {
			if (isIE) {
				show.events.add(document, 'focusout', show.freeze);
				show.events.add(document, 'focusin', show.resume);
			} else {
				show.events.add(window, 'blur', show.freeze);
				show.events.add(window, 'focus', show.resume);
			}
		}
		show.resizeHandler();
		show.scrollHandler();
		if (show.followMouse) {
			show.events.add(isIE ? document : window, 'mousemove', show.mouseMove);
		}
		show.animationInterval = Math.max(20, show.animationInterval);
		show.timerInit();
	};

	this.start = function(bFromOnLoad) {
		if (!didInit) {
			didInit = true;
		} else if (bFromOnLoad) {
			// already loaded and running
			return true;
		}
		if (typeof show.targetElement === 'string') {
			var targetID = show.targetElement;
			show.targetElement = document.getElementById(targetID);
			if (!show.targetElement) {
				throw new Error('Fireworkshow: Unable to get targetElement "' + targetID + '"');
			}
		}
		if (!show.targetElement) {
			show.targetElement = (document.body || document.documentElement);
		}
		if (show.targetElement !== document.documentElement && show.targetElement !== document.body) {
			// re-map handler to get element instead of screen dimensions
			show.resizeHandler = show.resizeHandlerAlt;
			//and force-enable pixel positioning
			show.usePixelPosition = true;
		}
		show.resizeHandler(); // get bounding box elements
		show.usePositionFixed = (show.usePositionFixed && !noFixed && !show.flakeBottom); // whether or not position:fixed is to be used
		if (window.getComputedStyle) {
			// attempt to determine if body or user-specified snow parent element is relatlively-positioned.
			try {
				targetElementIsRelative = (window.getComputedStyle(show.targetElement, null).getPropertyValue('position') === 'relative');
			} catch(e) {
				// oh well
				targetElementIsRelative = false;
			}
		}
		fixedForEverything = show.usePositionFixed;
		if (screenX && screenY && !show.disabled) {
			show.init();
			show.active = true;
		}
	};

	function doDelayedStart() {
		window.setTimeout(function() {
			show.start(true);
		}, 20);
		// event cleanup
		show.events.remove(isIE ? document : window, 'mousemove', doDelayedStart);
	}

	function doStart() {
		if ((!show.excludeMobile || !isMobile)) {
			doDelayedStart();
		}
		// event cleanup
		show.events.remove(window, 'load', doStart);
	}

	// hooks for starting the snow
	if (show.autoStart) {
		if (document.readyState === 'complete') {
			doStart();
		} else {
			show.events.add(window, 'load', doStart, false);
		}
	}
}());
