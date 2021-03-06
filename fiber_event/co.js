var slice = Array.prototype.slice;

module.exports = co;

function co(fn) {
	var isGenFun = isGeneratorFunction(fn);

	return function(done) {
		var ctx = this;
		var gen = fn;
		if (isGenFun) {
			var args = slice.call(arguments), len = args.length;
			var hasCallback = len && 'function' == typeof args[len - 1];
			done = hasCallback ? args.pop() : error;
			gen = fn.apply(this, args);
		} else {
			done = done || error;
		}

		next();

		function exit(err, res) {
			setImmediate(function() {
				done.call(ctx, err, res);
			});
		}

		function next(err, res) {
			var ret;
			if (arguments.length > 2) res = slice.call(arguments, 1);
			if (err) {
				try {
					ret = gen.throw(err);
				} catch (e) {
					return exit(e);
				}
			}

			if (!err) {
				try {
					ret = gen.next(res);
				} catch (e) {
					return exit(e);
				}
			}

			if (ret.done) return exit(null, ret.value);

			ret.value = toThunk(ret.value, ctx);

			// run
			if ('function' == typeof ret.value) {
				var called = false;
				try {
					ret.value.call(ctx, function() {
						if (called) return;
						called = true;
						next.apply(ctx, arguments);
					});
				} catch (e) {
					setImmediate(function() {
						if (called) return;
						called = true;
						next(e);
					});
				}
				return;
			}

			// invalid
			next(new TypeError('You may only yield a function, promise, generator, array, or object, '
				+ 'but the following was passed: "' + String(ret.value) + '"'));
		}
	}
}

function toThunk(obj, ctx) {

	if (isGeneratorFunction(obj)) {
		return co(obj.call(ctx));
	}

	if (isGenerator(obj)) {
		return co(obj);
	}

	if (isPromise(obj)) {
		return promiseToThunk(obj);
	}

	if ('function' == typeof obj) {
		return obj;
	}

	if (isObject(obj) || Array.isArray(obj)) {
		return objectToThunk.call(ctx, obj);
	}

	return obj;
}

function objectToThunk(obj) {
	var ctx = this;
	var isArray = Array.isArray(obj);

	return function(done) {
		var keys = Object.keys(obj);
		var pending = keys.length;
		var results = isArray
			? new Array(pending) // predefine the array length
			: new obj.constructor();
		var finished;

		if (!pending) {
			setImmediate(function() {
				done(null, results)
			});
			return;
		}

		// prepopulate object keys to preserve key ordering
		if (!isArray) {
			for (var i = 0; i < pending; i++) {
				results[keys[i]] = undefined;
			}
		}

		for (var i = 0; i < keys.length; i++) {
			run(obj[keys[i]], keys[i]);
		}

		function run(fn, key) {
			if (finished) return;
			try {
				fn = toThunk(fn, ctx);

				if ('function' != typeof fn) {
					results[key] = fn;
					return --pending || done(null, results);
				}

				fn.call(ctx, function(err, res) {
					if (finished) return;

					if (err) {
						finished = true;
						return done(err);
					}

					results[key] = res;
					--pending || done(null, results);
				});
			} catch (err) {
				finished = true;
				done(err);
			}
		}
	}
}

function promiseToThunk(promise) {
	return function(fn) {
		promise.then(function(res) {
			fn(null, res);
		}, fn);
	}
}

function isPromise(obj) {
	return obj && 'function' == typeof obj.then;
}

function isGenerator(obj) {
	return obj && 'function' == typeof obj.next && 'function' == typeof obj.throw;
}

function isGeneratorFunction(obj) {
	return obj && obj.constructor && 'GeneratorFunction' == obj.constructor.name;
}

function isObject(val) {
	return val && Object == val.constructor;
}

function error(err) {
	if (!err) return;
	setImmediate(function() {
		throw err;
	});
}