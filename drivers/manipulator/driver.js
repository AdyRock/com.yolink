'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class ManipulatorDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'Manipulator';
		this.homey.app.updateLog('ManipulatorDriver has been initialized');
	}
};
