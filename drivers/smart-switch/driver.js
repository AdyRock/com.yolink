'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class SmartSwitchDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'Switch';
		this.homey.app.updateLog('SmartSwitchDriver has been initialized');
	}

};
