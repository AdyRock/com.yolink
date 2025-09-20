'use strict';

if (process.env.DEBUG === '1')
{
	// eslint-disable-next-line node/no-unsupported-features/node-builtins, global-require
	require('inspector').open(9223, '0.0.0.0', true);
}

const Homey = require('homey');
const YoLinkAPI = require('./yoLinkAPI');

module.exports = class MyApp extends Homey.App
{

	/**
	 * onInit is called when the app is initialized.
	 */
	async onInit()
	{
		this.yoLinkAPI = new YoLinkAPI(this);
		this.log('MyApp has been initialized');
	}

};
