'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class THDriver extends yoLinkDriver
{

	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'THSensor';
		this.log('THDriver has been initialized');
	}

};
