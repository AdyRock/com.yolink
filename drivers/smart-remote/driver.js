'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class SmartRemoteDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'SmartRemoter';
		this.homey.app.updateLog('SmartRemoteDriver has been initialized');
	}

};
